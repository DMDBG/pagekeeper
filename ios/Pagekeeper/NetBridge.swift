import Foundation
import WebKit
import UIKit
import AVFoundation
import MediaPlayer

/// Lets the reader page fetch catalogs and download files natively (no browser CORS limits),
/// and open the in-app browser. Called from JS as:
///   await window.webkit.messageHandlers.pk.postMessage({op: "text" | "file" | "done" | "browse", ...})
final class NetBridge: NSObject, WKScriptMessageHandlerWithReply {
    weak var webView: WKWebView? { didSet { setUpAudioEvents() } }

    // MARK: calls and other audio
    // Like a video app, keep the book playing during a call (Discord, FaceTime, a phone call...):
    // when another app takes the audio, share it instead of stopping, and tell the page so it can carry on.
    // Unplugging headphones still pauses, as it should.
    private var audioEventsSet = false
    private var mixing = false
    private var mixTimer: Timer?

    private func post(_ what: String) {
        DispatchQueue.main.async { [weak self] in
            self?.webView?.evaluateJavaScript("window.pkAudio && window.pkAudio('\(what)')")
        }
    }

    private func setMixing(_ on: Bool) {
        guard on != mixing else { return }
        let s = AVAudioSession.sharedInstance()
        do {
            try s.setCategory(.playback, mode: .spokenAudio, options: on ? [.mixWithOthers] : [])
            try s.setActive(true)
            mixing = on
        } catch { return }
        mixTimer?.invalidate(); mixTimer = nil
        if on {
            // when the call is over, go back to being the main audio (lock screen controls come back)
            mixTimer = Timer.scheduledTimer(withTimeInterval: 20, repeats: true) { [weak self] _ in
                if !AVAudioSession.sharedInstance().isOtherAudioPlaying { self?.setMixing(false) }
            }
        }
    }

    private func setUpAudioEvents() {
        guard !audioEventsSet else { return }
        audioEventsSet = true
        let nc = NotificationCenter.default
        nc.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] note in
            guard let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
                  let type = AVAudioSession.InterruptionType(rawValue: raw) else { return }
            if type == .began {
                self?.setMixing(true)
                self?.post("interrupted")
            } else {
                self?.post("resume")
            }
        }
        nc.addObserver(forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main) { [weak self] note in
            guard let raw = note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt,
                  let reason = AVAudioSession.RouteChangeReason(rawValue: raw) else { return }
            if reason == .oldDeviceUnavailable { self?.post("unplugged") }   // headphones out: stay paused
        }
    }
    private var observers: [String: NSKeyValueObservation] = [:]

    // MARK: volume
    // iOS ignores volume set by a web page, so the player's slider moves the phone's media volume.
    // An almost-invisible system volume view does that (and stops iOS showing its volume pop-up).
    private lazy var volumeView: MPVolumeView = {
        let v = MPVolumeView(frame: CGRect(x: -2000, y: -2000, width: 120, height: 40))
        v.alpha = 0.01
        v.isUserInteractionEnabled = false
        return v
    }()
    private var volumeObserver: NSKeyValueObservation?

    private func setUpVolume() {
        if volumeView.superview == nil, let web = webView { web.addSubview(volumeView) }
        if volumeObserver == nil {
            volumeObserver = AVAudioSession.sharedInstance().observe(\.outputVolume, options: [.new]) { [weak self] session, _ in
                let v = session.outputVolume
                DispatchQueue.main.async {
                    self?.webView?.evaluateJavaScript("window.pkVolume && window.pkVolume(\(v))")
                }
            }
        }
    }

    private func setVolume(_ value: Float) {
        setUpVolume()
        let apply = { [weak self] in
            guard let slider = self?.volumeView.subviews.compactMap({ $0 as? UISlider }).first else { return }
            slider.setValue(value, animated: false)
            slider.sendActions(for: .valueChanged)
        }
        apply()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.05, execute: apply)   // the slider may appear a moment later
    }

    static let downloadsDir: URL = {
        let dir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("pkdl", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }()

    static func clearDownloads() {
        try? FileManager.default.removeItem(at: downloadsDir)
        try? FileManager.default.createDirectory(at: downloadsDir, withIntermediateDirectories: true)
    }

    /// AI services can take minutes to answer on a long chapter.
    private static let aiSession: URLSession = {
        let cfg = URLSessionConfiguration.default
        cfg.timeoutIntervalForRequest = 600
        cfg.timeoutIntervalForResource = 900
        return URLSession(configuration: cfg)
    }()

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

        case "http":
            // AI recaps: a request to an AI service (secure addresses only), answered as status + text.
            guard let s = body["url"] as? String, let url = URL(string: s), url.scheme?.lowercased() == "https" else {
                replyHandler(nil, "That address isn't allowed."); return
            }
            var req = URLRequest(url: url, timeoutInterval: 600)
            req.httpMethod = (body["method"] as? String) ?? "GET"
            for pair in (body["headers"] as? [[String]]) ?? [] where pair.count == 2 { req.setValue(pair[1], forHTTPHeaderField: pair[0]) }
            if let b = body["body"] as? String { req.httpBody = Data(b.utf8) }
            Self.aiSession.dataTask(with: req) { data, response, error in
                DispatchQueue.main.async {
                    if let error { replyHandler(nil, error.localizedDescription); return }
                    let status = (response as? HTTPURLResponse)?.statusCode ?? 0
                    replyHandler(["status": status, "text": data.flatMap { String(data: $0, encoding: .utf8) } ?? ""], nil)
                }
            }.resume()

        case "done":
            if let token = body["token"] as? String, !token.contains("/"), !token.contains("..") {
                try? FileManager.default.removeItem(at: Self.downloadsDir.appendingPathComponent(token))
            }
            replyHandler(true, nil)

        case "volume":
            let v = (body["value"] as? NSNumber)?.floatValue ?? 1
            setVolume(max(0, min(1, v)))
            replyHandler(true, nil)

        case "theme":
            // Dark, light, or follow the phone: sets the status bar and the in-app browser to match.
            let mode = body["mode"] as? String ?? "dark"
            let style: UIUserInterfaceStyle = mode == "light" ? .light : mode == "system" ? .unspecified : .dark
            webView?.window?.overrideUserInterfaceStyle = style
            replyHandler(true, nil)

        case "volumeGet":
            setUpVolume()
            replyHandler(Double(AVAudioSession.sharedInstance().outputVolume), nil)

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
    /// Downloads in progress. While any are running the screen stays on, so a long download
    /// isn't cut off when the phone locks itself.
    private static var active = 0

    func download(_ url: URL, progressId: String?, completion: @escaping (Result<[String: Any], Error>) -> Void) {
        var attempts = 0
        var bgTask: UIBackgroundTaskIdentifier = .invalid
        // A little extra time to finish if you switch apps mid-download.
        bgTask = UIApplication.shared.beginBackgroundTask(withName: "pk-download") {
            UIApplication.shared.endBackgroundTask(bgTask); bgTask = .invalid
        }
        Self.active += 1
        UIApplication.shared.isIdleTimerDisabled = true

        func finish(_ result: Result<[String: Any], Error>) {
            if let progressId { observers[progressId] = nil }
            Self.active -= 1
            if Self.active <= 0 { Self.active = 0; UIApplication.shared.isIdleTimerDisabled = false }
            if bgTask != .invalid { UIApplication.shared.endBackgroundTask(bgTask); bgTask = .invalid }
            completion(result)
        }

        func start(_ resumeData: Data?) {
            let handler: (URL?, URLResponse?, Error?) -> Void = { tmp, response, error in
                // iOS deletes the downloaded file as soon as this handler returns, so move it now.
                var stored: Result<[String: Any], Error>?
                if error == nil {
                    if let http = response as? HTTPURLResponse, http.statusCode >= 400 {
                        stored = .failure(NSError(domain: "Pagekeeper", code: http.statusCode,
                            userInfo: [NSLocalizedDescriptionKey: "The site said \(http.statusCode)."]))
                    } else if let tmp {
                        stored = Result { try Self.store(tmp, name: response?.suggestedFilename ?? url.lastPathComponent,
                                                         mime: response?.mimeType, source: response?.url ?? url) }
                    }
                }
                DispatchQueue.main.async {
                    if let error {
                        // A dropped connection picks up where it stopped (or starts over) a few times before giving up.
                        let ns = error as NSError
                        let data = ns.userInfo[NSURLSessionDownloadTaskResumeData] as? Data
                        let flaky: [URLError.Code] = [.networkConnectionLost, .timedOut, .notConnectedToInternet, .cannotConnectToHost]
                        if attempts < 6, let code = (error as? URLError)?.code, flaky.contains(code) {
                            attempts += 1
                            DispatchQueue.main.asyncAfter(deadline: .now() + Double(attempts)) { start(data) }
                            return
                        }
                        finish(.failure(error)); return
                    }
                    finish(stored ?? .failure(URLError(.cannotCreateFile)))
                }
            }
            let task = resumeData.map { Self.session.downloadTask(withResumeData: $0, completionHandler: handler) }
                ?? Self.session.downloadTask(with: url, completionHandler: handler)
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
        start(nil)
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
