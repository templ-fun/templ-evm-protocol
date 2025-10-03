// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

/// @notice Enumeration describing how entry fees scale as members join.
enum CurveStyle {
    Static,
    Linear,
    Exponential
}

/// @notice Segment configuration applied to member joins.
/// @param style Style of growth applied across all joins.
/// @param rateBps Rate parameter whose interpretation depends on `style`.
struct CurveSegment {
    CurveStyle style;
    uint32 rateBps;
}

/// @notice Pricing curve configuration applied uniformly across joins.
/// @param primary Growth segment that determines how the entry fee evolves.
struct CurveConfig {
    CurveSegment primary;
}
