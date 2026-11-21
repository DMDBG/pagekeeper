import AVFoundation
import MediaPlayer
import UIKit

/// The audiobook player on iPhone. The page used to play the book with a web <audio> element, but then
/// WebKit sets up the phone's audio its own way: during a call it kept getting cut off and starved.
/// Playing it here, like a video app does, keeps it going during calls (sharing the sound), in the
/// background, and on the lock screen.
///
/// The page hands over each part's file once (kept in a small cache here), then sends play / pause /
/// seek / speed, and gets back the time, "playing", "paused", "ended" and so on.
final class NativeAudio: NSObject {
    private let player = AVPlayer()
    private var timeObserver: Any?
    private var statusObserver: NSKeyValueObservation?
    private var controlObserver: NSKeyValueObservation?
    private var endObserver: NSObjectProtocol?
    private var rate: Float = 1
    private var key = ""
    private var meta: [String: Any] = [:]
    private var remoteSet = false
    /// Sends an event to the page: (name, extra fields).
    var post: ((String, [String: Any]) -> Void)?
    /// Called right before playing, so the bridge can share the sound with a call if one is going.
    var beforePlay: (() -> Void)?

    static let dir: URL = {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        let d = base.appendingPathComponent("pkau", isDirectory: true)
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        var url = d
        var rv = URLResourceValues(); rv.isExcludedFromBackup = true
        try? url.setResourceValues(rv)
        return d
    }()

    private static func file(_ key: String) -> URL {
        let safe = String(key.map { $0.isLetter || $0.isNumber || $0 == "-" || $0 == "." ? $0 : "_" })
        return dir.appendingPathComponent(safe)
    }

    override init() {
        super.init()
        player.automaticallyWaitsToMinimizeStalling = false   // local files: start right away
        timeObserver = player.addPeriodicTimeObserver(forInterval: CMTime(value: 1, timescale: 4), queue: .main) { [weak self] t in
            guard let self = self, self.player.currentItem != nil else { return }
            self.post?("time", ["t": max(0, CMTimeGetSeconds(t))])
        }
        controlObserver = player.observe(\.timeControlStatus, options: [.new]) { [weak self] p, _ in
            DispatchQueue.main.async {
                guard let self = self else { return }
                let t = max(0, CMTimeGetSeconds(p.currentTime()))
                switch p.timeControlStatus {
                case .playing: self.post?("playing", ["t": t])
                case .paused: self.post?("paused", ["t": t])
                default: self.post?("waiting", ["t": t])
                }
                self.updateNowPlaying()
            }
        }
    }

    // MARK: files

    func has(_ key: String, size: Int) -> Bool {
        let f = Self.file(key)
        guard let a = try? FileManager.default.attributesOfItem(atPath: f.path), let n = a[.size] as? Int else { return false }
        return size <= 0 || n == size
    }

    /// Write one piece of a part's file. The last piece moves it into place.
    func write(_ key: String, offset: Int, data: Data, done: Bool) throws {
        let tmp = Self.file(key).appendingPathExtension("part")
        if offset == 0 {
            try? FileManager.default.removeItem(at: tmp)
            FileManager.default.createFile(atPath: tmp.path, contents: nil)
        }
        let h = try FileHandle(forWritingTo: tmp)
        try h.seek(toOffset: UInt64(offset))
        try h.write(contentsOf: data)
        try h.close()
        if done {
            let f = Self.file(key)
            try? FileManager.default.removeItem(at: f)
            try FileManager.default.moveItem(at: tmp, to: f)
            tidy(keep: f)
        }
    }

    /// Keep only the last few parts here (the book itself stays in the page's storage).
    private func tidy(keep: URL) {
        let fm = FileManager.default
        guard let list = try? fm.contentsOfDirectory(at: Self.dir, includingPropertiesForKeys: [.contentModificationDateKey]) else { return }
        let cur = Self.file(key)
        let sorted = list.filter { $0.pathExtension != "part" }.sorted {
            let a = (try? $0.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast
            let b = (try? $1.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast
            return a > b
        }
        for (i, u) in sorted.enumerated() where i >= 4 && u != keep && u != cur { try? fm.removeItem(at: u) }
    }

    // MARK: playback

    func load(_ key: String) -> Bool {
        let f = Self.file(key)
        guard FileManager.default.fileExists(atPath: f.path) else { return false }
        self.key = key
        try? FileManager.default.setAttributes([.modificationDate: Date()], ofItemAtPath: f.path)
        let item = AVPlayerItem(url: f)
        item.audioTimePitchAlgorithm = .timeDomain   // speech stays natural at other speeds
        statusObserver = item.observe(\.status, options: [.new]) { [weak self] it, _ in
            DispatchQueue.main.async {
                guard let self = self else { return }
                if it.status == .readyToPlay {
                    self.post?("loaded", ["d": CMTimeGetSeconds(it.asset.duration)])
                    self.updateNowPlaying()
                } else if it.status == .failed {
                    self.post?("error", ["code": 4, "msg": it.error?.localizedDescription ?? ""])
                }
            }
        }
        if let o = endObserver { NotificationCenter.default.removeObserver(o) }
        endObserver = NotificationCenter.default.addObserver(forName: .AVPlayerItemDidPlayToEndTime, object: item, queue: .main) { [weak self] _ in
            self?.post?("ended", [:])
        }
        player.pause()
        player.replaceCurrentItem(with: item)
        setUpRemote()
        return true
    }

    func unload() {
        player.pause()
        player.replaceCurrentItem(with: nil)
        key = ""
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
    }

    func play() -> Bool {
        guard player.currentItem != nil else { return false }
        beforePlay?()
        try? AVAudioSession.sharedInstance().setActive(true)
        player.playImmediately(atRate: rate)
        return true
    }

    func pause() { player.pause() }

    func seek(_ t: Double) {
        player.seek(to: CMTime(seconds: max(0, t), preferredTimescale: 1000), toleranceBefore: .zero, toleranceAfter: .zero) { [weak self] _ in
            DispatchQueue.main.async {
                guard let self = self else { return }
                self.post?("seeked", ["t": max(0, CMTimeGetSeconds(self.player.currentTime()))])
                self.updateNowPlaying()
            }
        }
    }

    func setRate(_ r: Float) {
        rate = max(0.5, min(4, r))
        player.defaultRate = rate
        if player.rate > 0 { player.rate = rate }
        updateNowPlaying()
    }

    func setVolume(_ v: Float) { player.volume = max(0, min(1, v)) }

    var isPlaying: Bool { player.timeControlStatus != .paused }

    // MARK: lock screen and Control Center

    func setMeta(_ m: [String: Any]) {
        meta = m
        updateNowPlaying()
    }

    private func updateNowPlaying() {
        guard let item = player.currentItem else { return }
        var info: [String: Any] = [
            MPMediaItemPropertyTitle: meta["title"] as? String ?? "Pagekeeper",
            MPMediaItemPropertyArtist: meta["artist"] as? String ?? "",
            MPMediaItemPropertyAlbumTitle: meta["album"] as? String ?? "",
            MPNowPlayingInfoPropertyElapsedPlaybackTime: max(0, CMTimeGetSeconds(player.currentTime())),
            MPNowPlayingInfoPropertyPlaybackRate: player.timeControlStatus == .paused ? 0.0 : Double(rate),
            MPNowPlayingInfoPropertyDefaultPlaybackRate: Double(rate),
        ]
        let d = CMTimeGetSeconds(item.asset.duration)
        if d.isFinite { info[MPMediaItemPropertyPlaybackDuration] = d }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }

    private func setUpRemote() {
        guard !remoteSet else { return }
        remoteSet = true
        let c = MPRemoteCommandCenter.shared()
        // The page decides (so "paused by you" and the sleep timer stay right); it answers with play/pause.
        c.playCommand.addTarget { [weak self] _ in self?.post?("remote", ["cmd": "play"]); return .success }
        c.pauseCommand.addTarget { [weak self] _ in self?.post?("remote", ["cmd": "pause"]); return .success }
        c.togglePlayPauseCommand.addTarget { [weak self] _ in self?.post?("remote", ["cmd": "toggle"]); return .success }
        c.skipForwardCommand.preferredIntervals = [15]
        c.skipBackwardCommand.preferredIntervals = [15]
        c.skipForwardCommand.addTarget { [weak self] _ in self?.post?("remote", ["cmd": "fwd"]); return .success }
        c.skipBackwardCommand.addTarget { [weak self] _ in self?.post?("remote", ["cmd": "back"]); return .success }
        c.nextTrackCommand.addTarget { [weak self] _ in self?.post?("remote", ["cmd": "next"]); return .success }
        c.previousTrackCommand.addTarget { [weak self] _ in self?.post?("remote", ["cmd": "prev"]); return .success }
        c.changePlaybackPositionCommand.addTarget { [weak self] e in
            guard let ev = e as? MPChangePlaybackPositionCommandEvent else { return .commandFailed }
            self?.post?("remote", ["cmd": "seek", "t": ev.positionTime])
            return .success
        }
    }
}
