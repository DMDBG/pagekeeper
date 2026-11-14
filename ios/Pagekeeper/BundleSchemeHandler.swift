import Foundation
import WebKit
import UniformTypeIdentifiers

/// Serves the files in the app's built-in "web" folder at pagekeeper://app/...
/// A real origin (instead of file://) is what lets the page keep its library in IndexedDB.
/// Also serves finished downloads at pagekeeper://app/__dl/<token> so the page can import them.
final class BundleSchemeHandler: NSObject, WKURLSchemeHandler {
    static let scheme = "pagekeeper"
    private let root: URL? = Bundle.main.url(forResource: "web", withExtension: nil)?.standardizedFileURL

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url else { task.didFailWithError(URLError(.badURL)); return }
        var path = url.path
        if path.isEmpty || path == "/" { path = "/index.html" }

        var file: URL?
        if path.hasPrefix("/__dl/") {
            let token = String(path.dropFirst("/__dl/".count))
            if !token.isEmpty, !token.contains("/"), !token.contains("..") {
                let dir = NetBridge.downloadsDir.appendingPathComponent(token, isDirectory: true)
                file = (try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil))?.first
            }
        } else if let root {
            let candidate = root.appendingPathComponent(String(path.dropFirst())).standardizedFileURL
            if candidate.path.hasPrefix(root.path) { file = candidate }   // never serve anything outside the web folder
        }

        guard let file, let data = try? Data(contentsOf: file, options: .mappedIfSafe) else {
            let notFound = HTTPURLResponse(url: url, statusCode: 404, httpVersion: "HTTP/1.1", headerFields: nil)!
            task.didReceive(notFound); task.didReceive(Data()); task.didFinish(); return
        }
        let ext = file.pathExtension.lowercased()
        let mime = ext == "webmanifest" ? "application/manifest+json"
            : UTType(filenameExtension: ext)?.preferredMIMEType ?? "application/octet-stream"
        let headers = ["Content-Type": mime, "Content-Length": "\(data.count)", "Cache-Control": "no-cache"]
        let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: headers)!
        task.didReceive(response)
        task.didReceive(data)
        task.didFinish()
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}
