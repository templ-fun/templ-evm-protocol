import { describe, it, expect, vi } from 'vitest';
import { syncXMTP, waitForConversation } from '../../shared/xmtp.js';

describe('xmtpHelpers', () => {
  it('syncXMTP calls sync methods', async () => {
    const xmtp = {
      conversations: { sync: vi.fn(), syncAll: vi.fn() },
      preferences: { sync: vi.fn() }
    };
    await syncXMTP(xmtp);
    expect(xmtp.conversations.sync).toHaveBeenCalled();
    expect(xmtp.preferences.sync).toHaveBeenCalled();
    expect(xmtp.conversations.syncAll).toHaveBeenCalled();
  });

  it('waitForConversation returns group when found', async () => {
    const group = { id: 'g1', consentState: 'allowed' };
    const xmtp = {
      conversations: {
        getConversationById: vi.fn().mockResolvedValue(group),
        sync: vi.fn(),
        syncAll: vi.fn(),
        list: vi.fn().mockResolvedValue([group])
      },
      preferences: { sync: vi.fn() }
    };
    const result = await waitForConversation({ xmtp, groupId: 'g1', retries: 1, delayMs: 0 });
    expect(result).toEqual(group);
  });
});

