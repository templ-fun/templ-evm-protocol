export function extractTypedRequestParams(body) {
  const readNumber = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  };
  const chainId = readNumber(body?.chainId) ?? 1337;
  return {
    chainId,
    nonce: readNumber(body?.nonce),
    issuedAt: readNumber(body?.issuedAt),
    expiry: readNumber(body?.expiry)
  };
}
