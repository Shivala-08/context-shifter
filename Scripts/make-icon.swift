#!/usr/bin/env swift
// Generates AppIcon_1024.png — Context Transfer's app icon.
// Design: Big Sur squircle plate, dark vertical gradient, two opposing
// transfer arrows (blue → right, purple → left) with a small "context" spark.
import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

let size = 1024
let ctx = CGContext(
    data: nil, width: size, height: size,
    bitsPerComponent: 8, bytesPerRow: 0,
    space: CGColorSpace(name: CGColorSpace.sRGB)!,
    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
)!

ctx.setAllowsAntialiasing(true)
ctx.setShouldAntialias(true)

func rgba(_ r: CGFloat, _ g: CGFloat, _ b: CGFloat, _ a: CGFloat = 1) -> CGColor {
    CGColor(srgbRed: r / 255, green: g / 255, blue: b / 255, alpha: a)
}

// MARK: - Plate (Big Sur grid: 824/1024, radius ≈ 185.4)
let plateSize: CGFloat = 824
let plateOrigin = (CGFloat(size) - plateSize) / 2
let plateRect = CGRect(x: plateOrigin, y: plateOrigin, width: plateSize, height: plateSize)
let platePath = CGPath(roundedRect: plateRect, cornerWidth: 185, cornerHeight: 185, transform: nil)

// Subtle drop shadow under the plate.
ctx.saveGState()
ctx.setShadow(offset: CGSize(width: 0, height: -18), blur: 40, color: rgba(0, 0, 0, 0.35))
ctx.addPath(platePath)
ctx.setFillColor(rgba(0.1, 0.1, 0.11))
ctx.fillPath()
ctx.restoreGState()

// Plate fill: dark vertical gradient.
ctx.saveGState()
ctx.addPath(platePath)
ctx.clip()
let bg = CGGradient(
    colorsSpace: CGColorSpace(name: CGColorSpace.sRGB)!,
    colors: [rgba(0.16, 0.16, 0.18), rgba(0.08, 0.08, 0.10)] as CFArray,
    locations: [0, 1]
)!
ctx.drawLinearGradient(bg, start: CGPoint(x: 512, y: plateRect.maxY), end: CGPoint(x: 512, y: plateRect.minY), options: [])

// Soft radial glow behind the arrows (deep blue, very low alpha).
let glow = CGGradient(
    colorsSpace: CGColorSpace(name: CGColorSpace.sRGB)!,
    colors: [rgba(0.30, 0.45, 0.95, 0.30), rgba(0.30, 0.45, 0.95, 0.0)] as CFArray,
    locations: [0, 1]
)!
ctx.drawRadialGradient(glow, startCenter: CGPoint(x: 512, y: 470), startRadius: 0,
                       endCenter: CGPoint(x: 512, y: 470), endRadius: 340, options: [])
// Hairline inner border for that "glass edge".
ctx.addPath(platePath)
ctx.setStrokeColor(rgba(1, 1, 1, 0.10))
ctx.setLineWidth(3)
ctx.strokePath()
ctx.restoreGState()

// MARK: - Transfer arrows
// Top arrow → right (blue gradient); bottom arrow ← left (purple gradient).
func drawArrow(y: CGFloat, shaftFrom: CGFloat, tipTo: CGFloat, thickness: CGFloat,
               flip: Bool, from: CGColor, to: CGColor) {
    ctx.saveGState()

    // Clip to plate for safety.
    ctx.addPath(platePath)
    ctx.clip()

    let shaftLength = tipTo - shaftFrom - thickness * 1.9
    let shaftRect = CGRect(x: shaftFrom, y: y - thickness / 2, width: shaftLength, height: thickness)
    let shaft = CGPath(roundedRect: shaftRect, cornerWidth: thickness / 2, cornerHeight: thickness / 2, transform: nil)

    // Arrow head: triangle with rounded joins.
    let head = CGMutablePath()
    let hx = tipTo
    let hy = y
    let hw = thickness * 1.9
    head.move(to: CGPoint(x: hx, y: hy))
    head.addLine(to: CGPoint(x: hx - hw, y: hy + hw * 0.82))
    head.addLine(to: CGPoint(x: hx - hw, y: hy - hw * 0.82))
    head.closeSubpath()

    let grad = CGGradient(colorsSpace: CGColorSpace(name: CGColorSpace.sRGB)!,
                          colors: [from, to] as CFArray, locations: [0, 1])!
    let start = CGPoint(x: shaftFrom, y: 512)
    let end = CGPoint(x: tipTo, y: 512)

    ctx.addPath(shaft)
    ctx.clip()
    ctx.drawLinearGradient(grad, start: start, end: end, options: [])
    ctx.restoreGState()

    ctx.saveGState()
    ctx.addPath(platePath)
    ctx.clip()
    ctx.addPath(head)
    ctx.clip()
    ctx.drawLinearGradient(grad, start: start, end: end, options: [])
    ctx.restoreGState()
}

let mid = CGFloat(512)
// Blue: left → right, above center.
drawArrow(y: mid + 78, shaftFrom: 240, tipTo: 700, thickness: 74,
          flip: false, from: rgba(0.04, 0.52, 1.0), to: rgba(0.35, 0.78, 0.98))
// Purple: right → left, below center.
drawArrow(y: mid - 78, shaftFrom: 784, tipTo: 324, thickness: 74,
          flip: true, from: rgba(0.75, 0.35, 0.95), to: rgba(1.0, 0.18, 0.80))

// MARK: - Context spark (the "card/AI" hint), upper right between the arrows
let spark = CGMutablePath()
let c = CGPoint(x: 512, y: mid)
let rOuter: CGFloat = 56
let rInner: CGFloat = 22
for i in 0..<8 {
    let angle = CGFloat(i) * .pi / 4 - .pi / 2
    let radius = i.isMultiple(of: 2) ? rOuter : rInner
    let p = CGPoint(x: c.x + radius * cos(angle), y: c.y + radius * sin(angle))
    if i == 0 { spark.move(to: p) } else { spark.addLine(to: p) }
}
spark.closeSubpath()
ctx.saveGState()
ctx.addPath(spark)
ctx.setFillColor(rgba(1, 1, 1, 0.92))
ctx.fillPath()
ctx.restoreGState()

// MARK: - Export
let image = ctx.makeImage()!
let outURL = URL(fileURLWithPath: CommandLine.arguments.count > 1
    ? CommandLine.arguments[1] : "AppIcon_1024.png")
let dest = CGImageDestinationCreateWithURL(outURL as CFURL, UTType.png.identifier as CFString, 1, nil)!
CGImageDestinationAddImage(dest, image, nil)
CGImageDestinationFinalize(dest)
print("wrote \(outURL.path)")
