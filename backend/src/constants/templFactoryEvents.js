import { ethers } from 'ethers';

const EVENT_VARIANTS = [
  {
    id: 'current',
    abi: 'event TemplCreated(address indexed templ, address indexed creator, address indexed priest, address token, uint256 entryFee, uint256 burnPercent, uint256 treasuryPercent, uint256 memberPoolPercent, uint256 quorumPercent, uint256 executionDelaySeconds, address burnAddress, bool priestIsDictator, uint256 maxMembers, uint8 curvePrimaryStyle, uint32 curvePrimaryRateBps, uint8 curveSecondaryStyle, uint32 curveSecondaryRateBps, uint16 curvePivotPercentOfMax, string homeLink)'
  },
  {
    id: 'compat',
    abi: 'event TemplCreated(address indexed templ, address indexed creator, address indexed priest, address token, uint256 entryFee, uint256 burnPercent, uint256 treasuryPercent, uint256 memberPoolPercent, uint256 quorumPercent, uint256 executionDelaySeconds, address burnAddress, bool priestIsDictator, uint256 maxMembers, string homeLink)'
  }
];

const resolvedVariants = EVENT_VARIANTS.map((variant) => {
  const iface = new ethers.Interface([variant.abi]);
  const eventFragment = iface.getEvent('TemplCreated');
  const topicHash = eventFragment?.topicHash;
  if (!topicHash) {
    throw new Error('TemplCreated topic hash unavailable');
  }
  return {
    ...variant,
    interface: iface,
    fragment: eventFragment,
    topic: topicHash
  };
});

const topicToVariant = new Map(
  resolvedVariants.map((variant) => [variant.topic.toLowerCase(), variant])
);

export const FACTORY_EVENT_VARIANTS = Object.freeze(resolvedVariants);

export const TEMPL_CREATED_TOPICS = Object.freeze(
  FACTORY_EVENT_VARIANTS.map((variant) => variant.topic)
);

export function templCreatedVariantFor(topic) {
  if (!topic) return null;
  return topicToVariant.get(String(topic).toLowerCase()) ?? null;
}

export function parseTemplCreatedLog(log) {
  if (!log) return null;
  const variant = templCreatedVariantFor(log.topics?.[0]);
  if (!variant) return null;
  const parsed = variant.interface.parseLog(log);
  return { parsed, variant };
}
