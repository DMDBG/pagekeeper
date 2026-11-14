import Foundation
import WebKit
import UIKit

/// Lets the reader page fetch catalogs and download files natively (no browser CORS limits),
/// and open the in-app browser. Called from JS as:
///   await window.webkit.messageHandlers.pk.postMessage({op: "text" | "file" | "done" | "browse", ...})
final class NetBridge: NSObject, WKScriptMessageHandlerWithReply {
    weak var webView: WKWebView?
    private var observers: [String: NSKeyValueObservation] = [:]

    static let downloadsDir: URL = {
        let dir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("pkdl", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }()

    static func clearDownloads() {
        try? FileManager.default.removeItem(at: downloadsDir)
        try? FileManager.default.createDirectory(at: downloadsDir, withIntermediateDirectories: true)
    }

    private static let session: URLSession = {
        let cfg = URLSessionConfiguration.default
        cfg.timeoutIntervalForRequest = 60
        cfg.timeoutIntervalForResource = 60 * 60
        cfg.httpAdditionalHeaders = ["User-Agent": "Pagekeeper/1.0 (iPhone; ebook reader)"]
        return URLSession(configuration: cfg)
    }()

    func userContentController(_ ucc: WKUserContentController, didReceive message: WKScriptMessage,
                               replyHandler: @escaping (Any?, String?) -> Void) {
        // Only the app's own page may use the bridge.
        guard message.frameInfo.isMainFrame, message.frameInfo.securityOrigin.protocol == BundleSchemeHandler.scheme,
              let body = message.body as? [String: Any], let op = body["op"] as? String else {
            replyHandler(nil, "Not allowed."); return
        }
        switch op {
        case "text":
            guard let url = Self.webURL(body["url"]) else { replyHandler(nil, "That isn't a web address."); return }
            Self.session.dataTask(with: url) { data, response, error in
                DispatchQueue.main.async {
                    if let error { replyHandler(nil, error.localizedDescription); return }
                    let http = response as? HTTPURLResponse
                    let text = data.flatMap { String(data: $0, encoding: .utf8) ?? String(data: $0, encoding: .isoLatin1) } ?? ""
                    replyHandler(["status": http?.statusCode ?? 0, "text": text, "url": response?.url?.absoluteString ?? url.absoluteString], nil)
                }
            }.resume()

        case "file":
            guard let url = Self.webURL(body["url"]) else { replyHandler(nil, "That isn't a web address."); return }
            let id = body["id"] as? String ?? UUID().uuidString
            download(url, progressId: id) { result in
                switch result {
                case .success(let info): replyHandler(info, nil)
                case .failure(let error): replyHandler(nil, error.localizedDescription)
                }
            }

        case "done":
            if let token = body["token"] as? String, !token.contains("/"), !token.contains("..") {
                try? FileManager.default.removeItem(at: Self.downloadsDir.appendingPathComponent(token))
            }
            replyHandler(true, nil)

        case "browse":
            guard let url = Self.webURL(body["url"]) else { replyHandler(nil, "That isn't a web address."); return }
            presentBrowser(url)
            replyHandler(true, nil)

        default:
            replyHandler(nil, "Unknown request.")
        }
    }

    static func webURL(_ value: Any?) -> URL? {
        guard let s = value as? String, let url = URL(string: s), let scheme = url.scheme?.lowercased(),
              scheme == "https" || scheme == "http" else { return nil }
        return url
    }

    /// Downloads to Caches/pkdl/<token>/<filename>; the page reads it from pagekeeper://app/__dl/<token>.
    func download(_ url: URL, progressId: String?, completion: @escaping (Result<[String: Any], Error>) -> Void) {
        let task = Self.session.downloadTask(with: url) { [weak self] tmp, response, error in
            DispatchQueue.main.async {
                if let progressId { self?.observers[progressId] = nil }
                if let error { completion(.failure(error)); return }
                guard let tmp else { completion(.failure(URLError(.cannotCreateFile))); return }
                if let http = response as? HTTPURLResponse, http.statusCode >= 400 {
                    completion(.failure(NSError(domain: "Pagekeeper", code: http.statusCode,
                        userInfo: [NSLocalizedDescriptionKey: "The site said \(http.statusCode)."]))); return
                }
                do {
                    let info = try Self.store(tmp, name: response?.suggestedFilename ?? url.lastPathComponent,
                                              mime: response?.mimeType, source: response?.url ?? url)
                    completion(.success(info))
                } catch { completion(.failure(error)) }
            }
        }
        if let progressId, let web = webView {
            observers[progressId] = task.progress.observe(\.fractionCompleted) { [weak web] p, _ in
                let frac = p.fractionCompleted
                DispatchQueue.main.async {
                    web?.evaluateJavaScript("window.pkProgress && window.pkProgress(\(Self.js(progressId)), \(frac))")
                }
            }
        }
        task.resume()
    }

    /// Moves a finished download into the downloads folder and describes it for the page.
    static func store(_ tmp: URL, name: String, mime: String?, source: URL) throws -> [String: Any] {
        let token = UUID().uuidString
        let dir = downloadsDir.appendingPathComponent(token, isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let safeName = name.replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "\\", with: "_")
        let dest = dir.appendingPathComponent(safeName.isEmpty ? "download" : safeName)
        try FileManager.default.moveItem(at: tmp, to: dest)
        let size = (try? FileManager.default.attributesOfItem(atPath: dest.path)[.size] as? Int) ?? 0
        return ["token": token, "name": dest.lastPathComponent, "type": mime ?? "", "size": size, "url": source.absoluteString]
    }

    /// Tells the page a file arrived from the in-app browser.
    func deliver(_ info: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: info), let json = String(data: data, encoding: .utf8) else { return }
        webView?.evaluateJavaScript("window.pkReceived && window.pkReceived(\(json))")
    }

    func presentBrowser(_ url: URL) {
        guard let host = webView?.window?.rootViewController else { return }
        var top = host; while let p = top.presentedViewController { top = p }
        if let nav = top as? UINavigationController, let browser = nav.viewControllers.first as? BrowserViewController {
            browser.load(url); return
        }
        let browser = BrowserViewController(start: url, bridge: self)
        top.present(UINavigationController(rootViewController: browser), animated: true)
    }

    static func js(_ s: String) -> String {
        let data = (try? JSONSerialization.data(withJSONObject: [s])) ?? Data("[\"\"]".utf8)
        let arr = String(data: data, encoding: .utf8) ?? "[\"\"]"
        return String(arr.dropFirst().dropLast())
    }
}
