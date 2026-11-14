import UIKit
import WebKit

/// A browser inside Pagekeeper. Anything you download here (EPUB, PDF, TXT, MP3, M4B, zip)
/// is handed straight to your library instead of leaving the app.
final class BrowserViewController: UIViewController, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
    private let web: WKWebView
    private let start: URL
    private weak var bridge: NetBridge?
    private var pending: [ObjectIdentifier: (token: String, dest: URL, mime: String, source: URL)] = [:]
    private var currentMime = ""
    private let banner = UILabel()
    private var bannerTimer: Timer?

    private lazy var backItem = UIBarButtonItem(image: UIImage(systemName: "chevron.backward"), style: .plain, target: self, action: #selector(goBack))
    private lazy var forwardItem = UIBarButtonItem(image: UIImage(systemName: "chevron.forward"), style: .plain, target: self, action: #selector(goForward))
    private lazy var addItem = UIBarButtonItem(title: "Add to library", style: .done, target: self, action: #selector(addCurrent))

    private static let importable: Set<String> = ["epub", "pdf", "txt", "mp3", "m4a", "m4b", "mp4", "aac", "ogg", "opus", "wav", "flac", "zip"]
    private static let readableMimes: Set<String> = ["application/pdf", "text/plain", "application/epub+zip"]

    init(start: URL, bridge: NetBridge) {
        self.start = start
        self.bridge = bridge
        let cfg = WKWebViewConfiguration()
        cfg.allowsInlineMediaPlayback = true
        self.web = WKWebView(frame: .zero, configuration: cfg)
        super.init(nibName: nil, bundle: nil)
    }
    required init?(coder: NSCoder) { fatalError("not used") }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        web.navigationDelegate = self
        web.uiDelegate = self
        web.allowsBackForwardNavigationGestures = true
        web.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(web)

        banner.translatesAutoresizingMaskIntoConstraints = false
        banner.backgroundColor = UIColor.label.withAlphaComponent(0.9)
        banner.textColor = .systemBackground
        banner.font = .preferredFont(forTextStyle: .subheadline)
        banner.textAlignment = .center
        banner.numberOfLines = 2
        banner.layer.cornerRadius = 12
        banner.clipsToBounds = true
        banner.alpha = 0
        view.addSubview(banner)

        NSLayoutConstraint.activate([
            web.topAnchor.constraint(equalTo: view.topAnchor),
            web.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            web.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            web.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            banner.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 16),
            banner.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -16),
            banner.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -12),
            banner.heightAnchor.constraint(greaterThanOrEqualToConstant: 44)
        ])

        navigationItem.leftBarButtonItem = UIBarButtonItem(barButtonSystemItem: .done, target: self, action: #selector(close))
        navigationItem.rightBarButtonItem = UIBarButtonItem(barButtonSystemItem: .refresh, target: self, action: #selector(reload))
        navigationController?.isToolbarHidden = false
        toolbarItems = [backItem, .fixedSpace(24), forwardItem, .flexibleSpace(), addItem]
        addItem.isEnabled = false
        updateButtons()
        load(start)
    }

    func load(_ url: URL) { web.load(URLRequest(url: url)) }

    @objc private func close() { dismiss(animated: true) }
    @objc private func goBack() { web.goBack() }
    @objc private func goForward() { web.goForward() }
    @objc private func reload() { web.reload() }

    private func updateButtons() {
        backItem.isEnabled = web.canGoBack
        forwardItem.isEnabled = web.canGoForward
        title = web.title?.isEmpty == false ? web.title : web.url?.host
    }

    /// For a PDF or text file that's showing in the browser: download it into the library.
    @objc private func addCurrent() {
        guard let url = web.url, let bridge else { return }
        show("Adding to your library…")
        bridge.download(url, progressId: nil) { [weak self] result in
            switch result {
            case .success(let info): bridge.deliver(info); self?.show("Added to Pagekeeper ✓")
            case .failure(let e): self?.show("Couldn't download: \(e.localizedDescription)")
            }
        }
    }

    private func show(_ text: String) {
        banner.text = "  \(text)  "
        UIView.animate(withDuration: 0.2) { self.banner.alpha = 1 }
        bannerTimer?.invalidate()
        bannerTimer = Timer.scheduledTimer(withTimeInterval: 3.5, repeats: false) { [weak self] _ in
            UIView.animate(withDuration: 0.3) { self?.banner.alpha = 0 }
        }
    }

    // MARK: navigation

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if action.shouldPerformDownload { decisionHandler(.download); return }
        if let scheme = action.request.url?.scheme?.lowercased(), !["http", "https", "about", "blob", "data"].contains(scheme) {
            if let url = action.request.url { UIApplication.shared.open(url) }   // mailto:, app links
            decisionHandler(.cancel); return
        }
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse,
                 decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        let mime = response.response.mimeType ?? ""
        let ext = ((response.response.suggestedFilename ?? response.response.url?.lastPathComponent ?? "") as NSString).pathExtension.lowercased()
        let disposition = (response.response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Content-Disposition")?.lowercased() ?? ""
        if response.isForMainFrame {
            currentMime = mime
            addItem.isEnabled = Self.readableMimes.contains(mime)
        }
        let viewable = ext == "pdf" || ext == "txt"
        if !response.canShowMIMEType || disposition.contains("attachment") || (Self.importable.contains(ext) && !viewable) {
            decisionHandler(.download)
        } else {
            decisionHandler(.allow)
        }
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) { download.delegate = self }
    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) { download.delegate = self }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { updateButtons() }
    func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) { updateButtons() }

    /// target="_blank" links open in this same browser.
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if action.targetFrame == nil { webView.load(action.request) }
        return nil
    }

    // MARK: downloads

    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String,
                  completionHandler: @escaping (URL?) -> Void) {
        let token = UUID().uuidString
        let dir = NetBridge.downloadsDir.appendingPathComponent(token, isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let name = suggestedFilename.replacingOccurrences(of: "/", with: "_")
        let dest = dir.appendingPathComponent(name.isEmpty ? "download" : name)
        pending[ObjectIdentifier(download)] = (token, dest, response.mimeType ?? "", response.url ?? web.url ?? start)
        show("Downloading \(name)…")
        completionHandler(dest)
    }

    func downloadDidFinish(_ download: WKDownload) {
        guard let p = pending.removeValue(forKey: ObjectIdentifier(download)) else { return }
        let ext = p.dest.pathExtension.lowercased()
        guard Self.importable.contains(ext) else {
            try? FileManager.default.removeItem(at: p.dest.deletingLastPathComponent())
            show("Pagekeeper can't open .\(ext.isEmpty ? "?" : ext) files. Look for EPUB, PDF, TXT or MP3.")
            return
        }
        let size = (try? FileManager.default.attributesOfItem(atPath: p.dest.path)[.size] as? Int) ?? 0
        bridge?.deliver(["token": p.token, "name": p.dest.lastPathComponent, "type": p.mime, "size": size, "url": p.source.absoluteString])
        show("Added \(p.dest.lastPathComponent) to Pagekeeper ✓")
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        pending.removeValue(forKey: ObjectIdentifier(download))
        show("Download failed: \(error.localizedDescription)")
    }
}
