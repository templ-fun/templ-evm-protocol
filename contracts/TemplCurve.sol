// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

/// @notice Enumeration describing how entry fees scale as members join.
enum CurveStyle {
    Static,
    Linear,
    Exponential
}

/// @notice Segment configuration applied to member joins.
/// @param style Style of growth applied while this segment is active.
/// @param rateBps Rate parameter whose interpretation depends on `style`.
/// @param length Number of paid joins covered by this segment (0 = infinite tail).
struct CurveSegment {
    CurveStyle style;
    uint32 rateBps;
    uint32 length;
}

/// @notice Pricing curve configuration composed of sequential segments.
/// @param primary First segment applied to new joins.
/// @param additionalSegments Optional follow-on segments processed in order.
struct CurveConfig {
    CurveSegment primary;
    CurveSegment[] additionalSegments;
}
