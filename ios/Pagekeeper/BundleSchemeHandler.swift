import Foundation
import WebKit
import UniformTypeIdentifiers

/// Serves the files in the app's built-in "web" folder at pagekeeper://app/...
/// A real origin (instead of file://) is what lets the page keep its library in IndexedDB.
final class BundleSchemeHandler: NSObject, WKURLSchemeHandler {
    static let scheme = "pagekeeper"
    private let root: URL? = Bundle.main.url(forResource: "web", withExtension: nil)?.standardizedFileURL

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url, let root else {
            task.didFailWithError(URLError(.badURL)); return
        }
        var path = url.path
        if path.isEmpty || path == "/" { path = "/index.html" }
        let file = root.appendingPathComponent(String(path.dropFirst())).standardizedFileURL

        // Never serve anything outside the web folder.
        guard file.path.hasPrefix(root.path), let data = try? Data(contentsOf: file) else {
            let notFound = HTTPURLResponse(url: url, statusCode: 404, httpVersion: "HTTP/1.1", headerFields: nil)!
            task.didReceive(notFound); task.didReceive(Data()); task.didFinish(); return
        }
        let type = UTType(filenameExtension: file.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
        let mime = file.pathExtension == "webmanifest" ? "application/manifest+json" : type
        let headers = ["Content-Type": mime, "Content-Length": "\(data.count)", "Cache-Control": "no-cache"]
        let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: headers)!
        task.didReceive(response)
        task.didReceive(data)
        task.didFinish()
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}
