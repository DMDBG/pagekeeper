import SwiftUI
import WebKit
import AVFoundation

@main
struct PagekeeperApp: App {
    init() {
        // Lets audiobooks keep playing with the screen locked or the app in the background.
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio)
        try? AVAudioSession.sharedInstance().setActive(true)
        NetBridge.clearDownloads()   // leftovers from a previous launch
    }

    var body: some Scene {
        WindowGroup {
            ReaderWebView()
                .ignoresSafeArea()
                .background(Color(red: 0.95, green: 0.96, blue: 0.97))
        }
    }
}

/// Hosts the bundled web app. Pages load from the app itself (pagekeeper://app/...),
/// so reading works with no connection; only sync and downloads talk to the internet.
struct ReaderWebView: UIViewRepresentable {
    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(BundleSchemeHandler(), forURLScheme: BundleSchemeHandler.scheme)
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.websiteDataStore = .default()   // keeps the library and downloaded files between launches
        config.userContentController.addScriptMessageHandler(context.coordinator.bridge, contentWorld: .page, name: "pk")

        let webView = WKWebView(frame: .zero, configuration: config)
        context.coordinator.bridge.webView = webView
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.scrollView.bounces = false
        webView.allowsBackForwardNavigationGestures = false
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        if #available(iOS 16.4, *) { webView.isInspectable = true }

        webView.load(URLRequest(url: URL(string: "\(BundleSchemeHandler.scheme)://app/index.html")!))
        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
        let bridge = NetBridge()

        /// Website links open in Pagekeeper's own browser, so you never leave the app.
        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                     decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            if let url = action.request.url, let scheme = url.scheme?.lowercased() {
                if scheme == "http" || scheme == "https" {
                    bridge.presentBrowser(url)
                    decisionHandler(.cancel); return
                }
                if scheme == "mailto" || scheme == "tel" {
                    UIApplication.shared.open(url)
                    decisionHandler(.cancel); return
                }
            }
            decisionHandler(.allow)
        }

        /// target="_blank" links.
        func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                     for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
            if let url = action.request.url, let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https" {
                bridge.presentBrowser(url)
            }
            return nil
        }

        /// If iOS ever kills the web content to save memory, reload instead of showing a blank screen.
        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
            webView.reload()
        }
    }
}
