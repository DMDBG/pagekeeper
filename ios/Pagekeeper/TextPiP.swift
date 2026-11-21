import AVKit
import AVFoundation
import CoreMedia
import UIKit

/// The floating text window (picture in picture), made by the app itself the way video apps do it.
/// The page draws the text and sends each new picture here; this shows it in a system floating window
/// that stays on top of other apps. There's no hidden web video, which on iOS counts as a camera/call
/// stream and kept interrupting the audiobook while Pagekeeper was on screen.
final class TextPiP: NSObject, AVPictureInPictureControllerDelegate, AVPictureInPictureSampleBufferPlaybackDelegate {
    private let displayLayer = AVSampleBufferDisplayLayer()
    private let host = UIView(frame: CGRect(x: 0, y: 0, width: 1, height: 1))
    private var controller: AVPictureInPictureController?
    private var possibleObserver: NSKeyValueObservation?
    var playing = false
    var onEvent: ((String) -> Void)?

    static var supported: Bool { AVPictureInPictureController.isPictureInPictureSupported() }

    /// Called once the web view exists: the source layer has to be in the view hierarchy.
    func attach(to view: UIView) {
        guard host.superview == nil, Self.supported else { return }
        host.isUserInteractionEnabled = false
        host.backgroundColor = .clear
        displayLayer.frame = host.bounds
        displayLayer.videoGravity = .resizeAspect
        host.layer.addSublayer(displayLayer)
        view.addSubview(host)
        let source = AVPictureInPictureController.ContentSource(sampleBufferDisplayLayer: displayLayer, playbackDelegate: self)
        let c = AVPictureInPictureController(contentSource: source)
        c.delegate = self
        c.requiresLinearPlayback = false
        controller = c
        // a first blank picture, so the window is ready to open
        if let blank = Self.blankImage() { show(blank) }
    }

    var isActive: Bool { controller?.isPictureInPictureActive ?? false }

    /// Open the floating window; waits up to 1.5 s for iOS to say it can.
    func start(_ done: @escaping (Bool) -> Void) {
        guard let c = controller else { done(false); return }
        var tries = 0
        func attempt() {
            if c.isPictureInPicturePossible { c.startPictureInPicture(); done(true); return }
            tries += 1
            if tries > 15 { done(false); return }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.1, execute: attempt)
        }
        attempt()
    }

    func stop() { controller?.stopPictureInPicture() }

    func setPlaying(_ p: Bool) {
        playing = p
        controller?.invalidatePlaybackState()
    }

    /// Show a new picture of the text.
    func show(_ image: CGImage) {
        guard let pb = Self.pixelBuffer(image) else { return }
        var fmt: CMVideoFormatDescription?
        CMVideoFormatDescriptionCreateForImageBuffer(allocator: kCFAllocatorDefault, imageBuffer: pb, formatDescriptionOut: &fmt)
        guard let format = fmt else { return }
        var timing = CMSampleTimingInfo(duration: .invalid,
                                        presentationTimeStamp: CMClockGetTime(CMClockGetHostTimeClock()),
                                        decodeTimeStamp: .invalid)
        var sample: CMSampleBuffer?
        CMSampleBufferCreateReadyWithImageBuffer(allocator: kCFAllocatorDefault, imageBuffer: pb, formatDescription: format,
                                                 sampleTiming: &timing, sampleBufferOut: &sample)
        guard let s = sample else { return }
        if let attachments = CMSampleBufferGetSampleAttachmentsArray(s, createIfNecessary: true), CFArrayGetCount(attachments) > 0 {
            let dict = unsafeBitCast(CFArrayGetValueAtIndex(attachments, 0), to: CFMutableDictionary.self)
            CFDictionarySetValue(dict,
                                 Unmanaged.passUnretained(kCMSampleAttachmentKey_DisplayImmediately).toOpaque(),
                                 Unmanaged.passUnretained(kCFBooleanTrue).toOpaque())
        }
        if displayLayer.status == .failed { displayLayer.flush() }
        displayLayer.enqueue(s)
    }

    private static func pixelBuffer(_ img: CGImage) -> CVPixelBuffer? {
        let w = img.width, h = img.height
        let attrs: [CFString: Any] = [kCVPixelBufferCGImageCompatibilityKey: true,
                                      kCVPixelBufferCGBitmapContextCompatibilityKey: true,
                                      kCVPixelBufferIOSurfacePropertiesKey: [String: Any]()]
        var out: CVPixelBuffer?
        guard CVPixelBufferCreate(kCFAllocatorDefault, w, h, kCVPixelFormatType_32BGRA, attrs as CFDictionary, &out) == kCVReturnSuccess,
              let buf = out else { return nil }
        CVPixelBufferLockBaseAddress(buf, [])
        defer { CVPixelBufferUnlockBaseAddress(buf, []) }
        guard let ctx = CGContext(data: CVPixelBufferGetBaseAddress(buf), width: w, height: h, bitsPerComponent: 8,
                                  bytesPerRow: CVPixelBufferGetBytesPerRow(buf), space: CGColorSpaceCreateDeviceRGB(),
                                  bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue)
        else { return nil }
        ctx.draw(img, in: CGRect(x: 0, y: 0, width: w, height: h))
        return buf
    }

    private static func blankImage() -> CGImage? {
        let r = UIGraphicsImageRenderer(size: CGSize(width: 720, height: 540))
        return r.image { c in
            UIColor(red: 0.067, green: 0.075, blue: 0.094, alpha: 1).setFill()
            c.fill(CGRect(x: 0, y: 0, width: 720, height: 540))
        }.cgImage
    }

    // MARK: the floating window's own buttons

    func pictureInPictureController(_ c: AVPictureInPictureController, setPlaying playing: Bool) {
        onEvent?(playing ? "play" : "pause")
    }
    func pictureInPictureControllerTimeRangeForPlayback(_ c: AVPictureInPictureController) -> CMTimeRange {
        CMTimeRange(start: .negativeInfinity, duration: .positiveInfinity)   // "live": no progress bar
    }
    func pictureInPictureControllerIsPlaybackPaused(_ c: AVPictureInPictureController) -> Bool { !playing }
    func pictureInPictureController(_ c: AVPictureInPictureController, didTransitionToRenderSize newRenderSize: CMVideoDimensions) {}
    func pictureInPictureController(_ c: AVPictureInPictureController, skipByInterval skipInterval: CMTime,
                                    completion completionHandler: @escaping () -> Void) {
        onEvent?(CMTimeGetSeconds(skipInterval) < 0 ? "back" : "fwd")
        completionHandler()
    }

    // MARK: opened / closed

    func pictureInPictureControllerDidStartPictureInPicture(_ c: AVPictureInPictureController) { onEvent?("opened") }
    func pictureInPictureControllerDidStopPictureInPicture(_ c: AVPictureInPictureController) { onEvent?("closed") }
    func pictureInPictureController(_ c: AVPictureInPictureController, failedToStartPictureInPictureWithError error: Error) {
        onEvent?("failed")
    }
}
