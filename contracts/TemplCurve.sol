// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

/// @notice Enumeration describing how entry fees scale as members join.
enum CurveStyle {
    Static,
    Linear,
    Exponential
}

/// @notice Segment configuration applied to a contiguous range of joins.
/// @param style Style of growth applied within the segment.
/// @param rateBps Rate parameter whose interpretation depends on `style`.
struct CurveSegment {
    CurveStyle style;
    uint32 rateBps;
}

/// @notice Pricing curve configuration supporting optional two-phase growth.
/// @param primary First segment applied from 0 joins until the pivot (exclusive).
/// @param secondary Second segment applied after the pivot when enabled.
/// @param pivotPercentOfMax Percentage (basis points) of the member cap that acts as the pivot when
/// `MAX_MEMBERS` is configured. The pivot operates on the number of paid joins (total members minus one
/// for the auto-enrolled priest).
struct CurveConfig {
    CurveSegment primary;
    CurveSegment secondary;
    uint16 pivotPercentOfMax;
}
