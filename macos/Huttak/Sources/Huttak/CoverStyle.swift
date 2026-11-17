import AppKit
import ScreenCaptureKit

/// How the original text looks, so the cover can be drawn in the same colors and type.
struct CoverStyle {
    var background: NSColor = .textBackgroundColor
    var foreground: NSColor = .labelColor
    var fontName: String?
    var fontSize: CGFloat = 0

    func font(size: CGFloat) -> NSFont {
        if let fontName, let font = NSFont(name: fontName, size: size) { return font }
        return NSFont.systemFont(ofSize: size)
    }
}

/// Reads the colors under the selection from the screen before the cover hides it.
/// Needs Screen Recording. Without it the cover keeps the system text colors.
enum CoverSampler {
    private static var asked = false

    static func sample(rects: [CGRect], into style: CoverStyle) async -> CoverStyle {
        var style = style
        guard let union = rects.dropFirst().reduce(rects.first, { $0?.union($1) }),
              union.width > 2, union.height > 2
        else { return style }
        guard CGPreflightScreenCaptureAccess() else {
            if !asked {
                asked = true
                HuttakLog.write("screen recording off: cover uses system colors")
                CGRequestScreenCaptureAccess()
            }
            return style
        }
        // The ring around the text gives the background. Inside, a selection highlight or the
        // app's own popup can change the color, so only the glyph color is read there.
        let margin: CGFloat = 6
        guard let image = await capture(union.insetBy(dx: -margin, dy: -margin)) else { return style }
        let scale = CGFloat(image.width) / (union.width + margin * 2)
        if let colors = dominantColors(image, margin: Int((margin * scale).rounded())) {
            style.background = colors.background
            style.foreground = colors.foreground
        }
        return style
    }

    /// Captures the area in AppKit screen coordinates, leaving out Huttak's own windows.
    private static func capture(_ rect: CGRect) async -> CGImage? {
        guard let screen = NSScreen.screens.first(where: { $0.frame.intersects(rect) }),
              let number = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber
        else { return nil }
        do {
            let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
            guard let display = content.displays.first(where: { $0.displayID == number.uint32Value }) else { return nil }
            let own = content.applications.filter { $0.processID == getpid() }
            let filter = SCContentFilter(display: display, excludingApplications: own, exceptingWindows: [])
            let local = rect.intersection(screen.frame)
            // ScreenCaptureKit's source rect is in the display's points with a top-left origin.
            let source = CGRect(
                x: local.minX - screen.frame.minX,
                y: screen.frame.maxY - local.maxY,
                width: local.width,
                height: local.height
            )
            let config = SCStreamConfiguration()
            config.sourceRect = source
            config.width = Int(source.width * screen.backingScaleFactor)
            config.height = Int(source.height * screen.backingScaleFactor)
            config.showsCursor = false
            return try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: config)
        } catch {
            HuttakLog.write("screen sample failed: \(error.localizedDescription)")
            return nil
        }
    }

    /// The most common color in the ring outside the text is the background. Inside, the most
    /// common color is the background or a selection highlight, and the most common color
    /// that stands apart from it is the text.
    static func dominantColors(_ image: CGImage, margin: Int) -> (background: NSColor, foreground: NSColor)? {
        let width = image.width
        let height = image.height
        guard width > margin * 2 + 2, height > margin * 2 + 2 else { return nil }
        var pixels = [UInt8](repeating: 0, count: width * height * 4)
        guard let context = CGContext(
            data: &pixels,
            width: width,
            height: height,
            bitsPerComponent: 8,
            bytesPerRow: width * 4,
            space: CGColorSpace(name: CGColorSpace.sRGB)!,
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        ) else { return nil }
        context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))

        typealias RGB = (r: Double, g: Double, b: Double)
        struct Bucket { var count = 0; var r = 0; var g = 0; var b = 0 }
        var ring: [Int: Bucket] = [:]
        var inner: [Int: Bucket] = [:]
        let step = max(1, Int((Double(width * height) / 80_000).squareRoot()))
        for y in stride(from: 0, to: height, by: step) {
            for x in stride(from: 0, to: width, by: step) {
                let o = (y * width + x) * 4
                let r = Int(pixels[o]), g = Int(pixels[o + 1]), b = Int(pixels[o + 2])
                let key = (r >> 4) << 8 | (g >> 4) << 4 | (b >> 4)
                let inside = x >= margin && x < width - margin && y >= margin && y < height - margin
                var bucket = (inside ? inner : ring)[key, default: Bucket()]
                bucket.count += 1
                bucket.r += r
                bucket.g += g
                bucket.b += b
                if inside { inner[key] = bucket } else { ring[key] = bucket }
            }
        }
        func color(_ b: Bucket) -> RGB {
            (Double(b.r) / Double(b.count) / 255, Double(b.g) / Double(b.count) / 255, Double(b.b) / Double(b.count) / 255)
        }
        func luminance(_ c: RGB) -> Double { 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b }

        let innerSorted = inner.values.sorted { $0.count > $1.count }
        guard let innerTop = innerSorted.first else { return nil }
        let bg = (ring.values.max { $0.count < $1.count }).map(color) ?? color(innerTop)
        let fill = luminance(color(innerTop))
        let text = innerSorted.dropFirst().first { abs(luminance(color($0)) - fill) > 0.3 }
        let gray = luminance(bg) > 0.5 ? 0.1 : 0.95
        let fg: RGB = text.map(color) ?? (gray, gray, gray)
        return (
            NSColor(srgbRed: bg.r, green: bg.g, blue: bg.b, alpha: 1),
            NSColor(srgbRed: fg.r, green: fg.g, blue: fg.b, alpha: 1)
        )
    }
}
