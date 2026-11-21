import Foundation

/// Finds which text runs a web selection touches. Web views report the selection as one
/// string with no breaks between blocks, and may start or end inside a run.
enum SelectionRuns {
    /// A label the app keeps out of text selection, such as a sender name or a time, can sit
    /// between selected runs. Up to this many in a row are stepped over.
    private static let maxSkippedRuns = 4

    /// Indices of the runs the selection covers, in order, or nil when they do not add up to
    /// the selection. A run that is only partly selected at either end is included.
    static func touched(selection: String, runs: [String]) -> [Int]? {
        let wanted = Array(compact(selection))
        guard !wanted.isEmpty else { return nil }
        let pieces = runs.map { Array(compact($0)) }
        var best: [Int]?
        for start in pieces.indices where !pieces[start].isEmpty {
            guard var position = openingLength(pieces[start], wanted) else { continue }
            var found = [start]
            if position == wanted.count { return found }
            var skipped = 0
            var index = start + 1
            scan: while index < pieces.count, skipped <= maxSkippedRuns {
                let piece = pieces[index]
                if !piece.isEmpty {
                    if let next = advance(piece, wanted, from: position) {
                        found.append(index)
                        position = next
                        skipped = 0
                        if position == wanted.count {
                            // The same words can appear twice. The tightest match is the selection.
                            if best == nil || spread(found) < spread(best ?? []) { best = found }
                            break scan
                        }
                    } else {
                        skipped += 1
                    }
                }
                index += 1
            }
        }
        return best
    }

    private static func spread(_ indices: [Int]) -> Int {
        (indices.last ?? 0) - (indices.first ?? 0)
    }

    private static func compact(_ text: String) -> String {
        // U+FFFC stands in for an embedded image or button inside web selection text.
        String(text.unicodeScalars.filter { !CharacterSet.whitespacesAndNewlines.contains($0) && $0 != "\u{FFFC}" }
            .map(Character.init))
    }

    /// How much of the selection this first run supplies: all of the run, the selection
    /// itself when it sits inside the run, or the run's tail when the selection starts mid-run.
    private static func openingLength(_ run: [Character], _ wanted: [Character]) -> Int? {
        if wanted.starts(with: run) { return run.count }
        if String(run).contains(String(wanted)) { return wanted.count }
        var length = min(run.count, wanted.count)
        while length > 0 {
            if Array(run.suffix(length)) == Array(wanted.prefix(length)) { return length }
            length -= 1
        }
        return nil
    }

    /// Consumes a following run, skipping a list marker the selection string carries.
    private static func advance(_ run: [Character], _ wanted: [Character], from position: Int) -> Int? {
        for start in [position, position + markerLength(wanted, at: position)] {
            guard start < wanted.count else { continue }
            let rest = wanted[start...]
            if rest.starts(with: run) { return start + run.count }
            if run.starts(with: rest) { return wanted.count }
        }
        return nil
    }

    private static func markerLength(_ text: [Character], at position: Int) -> Int {
        guard position < text.count else { return 0 }
        if "-*•‣◦·".contains(text[position]) { return 1 }
        var index = position
        while index < text.count, index - position < 3, text[index].isASCII, text[index].isNumber {
            index += 1
        }
        guard index > position, index < text.count, ".)".contains(text[index]) else { return 0 }
        return index + 1 - position
    }
}
