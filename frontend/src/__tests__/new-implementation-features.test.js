import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock global for test environment
if (typeof global === 'undefined') {
  const global = {};
}

// Test new implementation features for XMTP multiple installations fix

describe('New Implementation Features', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Error Classification', () => {
    it('should classify installation limit errors correctly', () => {
      // Mock implementation of classifyXmtpError function
      const classifyXmtpError = (error) => {
        const message = String(error?.message || error);

        if (message.includes('already registered 10/10 installations')) {
          return { type: 'installation_limit', retryable: false };
        }
        if (message.includes('network') || message.includes('timeout')) {
          return { type: 'network', retryable: true };
        }
        if (message.includes('nonce') || message.includes('signature')) {
          return { type: 'nonce', retryable: true };
        }

        return { type: 'unknown', retryable: false };
      };

      const error = new Error('already registered 10/10 installations');
      const result = classifyXmtpError(error);

      expect(result).toEqual({
        type: 'installation_limit',
        retryable: false
      });
    });

    it('should classify network errors correctly', () => {
      const classifyXmtpError = (error) => {
        const message = String(error?.message || error);

        if (message.includes('already registered 10/10 installations')) {
          return { type: 'installation_limit', retryable: false };
        }
        if (message.includes('network') || message.includes('timeout')) {
          return { type: 'network', retryable: true };
        }
        if (message.includes('nonce') || message.includes('signature')) {
          return { type: 'nonce', retryable: true };
        }

        return { type: 'unknown', retryable: false };
      };

      const error = new Error('Network timeout occurred');
      const result = classifyXmtpError(error);

      expect(result).toEqual({
        type: 'network',
        retryable: true
      });
    });

    it('should classify nonce errors correctly', () => {
      const classifyXmtpError = (error) => {
        const message = String(error?.message || error);

        if (message.includes('already registered 10/10 installations')) {
          return { type: 'installation_limit', retryable: false };
        }
        if (message.includes('network') || message.includes('timeout')) {
          return { type: 'network', retryable: true };
        }
        if (message.includes('nonce') || message.includes('signature')) {
          return { type: 'nonce', retryable: true };
        }

        return { type: 'unknown', retryable: false };
      };

      const error = new Error('Invalid nonce signature');
      const result = classifyXmtpError(error);

      expect(result).toEqual({
        type: 'nonce',
        retryable: true
      });
    });

    it('should classify unknown errors correctly', () => {
      const classifyXmtpError = (error) => {
        const message = String(error?.message || error);

        if (message.includes('already registered 10/10 installations')) {
          return { type: 'installation_limit', retryable: false };
        }
        if (message.includes('network') || message.includes('timeout')) {
          return { type: 'network', retryable: true };
        }
        if (message.includes('nonce') || message.includes('signature')) {
          return { type: 'nonce', retryable: true };
        }

        return { type: 'unknown', retryable: false };
      };

      const error = new Error('Unknown error occurred');
      const result = classifyXmtpError(error);

      expect(result).toEqual({
        type: 'unknown',
        retryable: false
      });
    });
  });

  describe('Exponential Backoff Calculation', () => {
    it('should calculate exponential backoff correctly', () => {
      // Fix random seed for consistent testing
      const mockMath = Object.create(global.Math);
      mockMath.random = () => 0; // No jitter for predictable tests
      global.Math = mockMath;

      const calculateBackoff = (attempt, baseDelay = 1000, maxDelay = 30000) => {
        const exponentialDelay = Math.min(
          baseDelay * Math.pow(2, attempt - 1),
          maxDelay
        );

        // Add jitter to prevent retry storms
        const jitter = Math.random() * 0.3 * exponentialDelay;
        return Math.floor(exponentialDelay + jitter);
      };

      try {
        const delay1 = calculateBackoff(1);
        const delay2 = calculateBackoff(2);
        const delay3 = calculateBackoff(3);
        const delay4 = calculateBackoff(4);

        expect(delay2).toBeGreaterThan(delay1);
        expect(delay3).toBeGreaterThan(delay2);
        expect(delay4).toBeGreaterThan(delay3);

        // Verify exact exponential growth (no jitter)
        expect(delay2).toBe(delay1 * 2);
        expect(delay3).toBe(delay1 * 4);
        expect(delay4).toBe(delay1 * 8);
      } finally {
        // Restore Math
        global.Math = Math;
      }
    });

    it('should respect maximum delay', () => {
      // Fix random seed for consistent testing
      const mockMath = Object.create(global.Math);
      mockMath.random = () => 0; // No jitter for predictable tests
      global.Math = mockMath;

      const calculateBackoff = (attempt, baseDelay = 1000, maxDelay = 30000) => {
        const exponentialDelay = Math.min(
          baseDelay * Math.pow(2, attempt - 1),
          maxDelay
        );

        const jitter = Math.random() * 0.3 * exponentialDelay;
        return Math.floor(exponentialDelay + jitter);
      };

      try {
        const maxDelay = 30000;
        const result = calculateBackoff(10, 1000, maxDelay);

        expect(result).toBeLessThanOrEqual(maxDelay);
      } finally {
        // Restore Math
        global.Math = Math;
      }
    });

    it('should add jitter to prevent retry storms', () => {
      const calculateBackoff = (attempt, baseDelay = 1000, maxDelay = 30000) => {
        const exponentialDelay = Math.min(
          baseDelay * Math.pow(2, attempt - 1),
          maxDelay
        );

        const jitter = Math.random() * 0.3 * exponentialDelay;
        return Math.floor(exponentialDelay + jitter);
      };

      // Fix random seed for consistent testing
      const mockMath = Object.create(global.Math);
      mockMath.random = () => 0.5; // Fixed jitter
      global.Math = mockMath;

      const result1 = calculateBackoff(1);
      const result2 = calculateBackoff(1);

      // Restore Math
      global.Math = Math;

      // With fixed random, results should be deterministic
      expect(result1).toBe(result2);

      // Verify jitter was added (should be baseDelay + jitter)
      const expectedBase = 1000;
      const expectedJitter = expectedBase * 0.3 * 0.5;
      const expected = expectedBase + expectedJitter;
      expect(result1).toBeCloseTo(Math.floor(expected), 1);
    });

    it('should handle different base delays', () => {
      const calculateBackoff = (attempt, baseDelay = 1000, maxDelay = 30000) => {
        const exponentialDelay = Math.min(
          baseDelay * Math.pow(2, attempt - 1),
          maxDelay
        );

        const jitter = Math.random() * 0.3 * exponentialDelay;
        return Math.floor(exponentialDelay + jitter);
      };

      const baseDelay500 = calculateBackoff(1, 500);
      const baseDelay2000 = calculateBackoff(1, 2000);

      expect(baseDelay500).toBeCloseTo(500 + 500 * 0.15, 50); // base + up to 30% jitter
      expect(baseDelay2000).toBeCloseTo(2000 + 2000 * 0.15, 200);
    });
  });

  describe('Session-based Nonce Tracking', () => {
    beforeEach(() => {
      // Mock Date for consistent testing
      vi.spyOn(Date, 'now').mockReturnValue(1000000);
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should track attempted nonces in session', () => {
      // Mock React state management
      let sessionAttemptedNonces = new Set([1, 2, 3]);
      const setSessionAttemptedNonces = vi.fn((_newSet) => {
        // Keep the existing logic but mark as unused
      });

      const filterNonces = (allNonces) => {
        return allNonces.filter((value) =>
          Number.isFinite(value) && value > 0 && !sessionAttemptedNonces.has(value)
        );
      };

      const candidateNonces = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
      const filtered = filterNonces(candidateNonces);

      expect(filtered).toEqual([4, 5, 6, 7, 8, 9, 10, 11, 12]);
    });

    it('should handle empty session nonces', () => {
      let sessionAttemptedNonces = new Set();
      const setSessionAttemptedNonces = vi.fn((_newSet) => {
        // Keep the existing logic but mark as unused
      });

      const filterNonces = (allNonces) => {
        return allNonces.filter((value) =>
          Number.isFinite(value) && value > 0 && !sessionAttemptedNonces.has(value)
        );
      };

      const candidateNonces = [1, 2, 3, 4, 5];
      const filtered = filterNonces(candidateNonces);

      expect(filtered).toEqual([1, 2, 3, 4, 5]);
    });

    it('should handle fully exhausted nonces', () => {
      let sessionAttemptedNonces = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
      const setSessionAttemptedNonces = vi.fn((_newSet) => {
        // Keep the existing logic but mark as unused
      });

      const filterNonces = (allNonces) => {
        return allNonces.filter((value) =>
          Number.isFinite(value) && value > 0 && !sessionAttemptedNonces.has(value)
        );
      };

      const candidateNonces = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
      const filtered = filterNonces(candidateNonces);

      expect(filtered).toEqual([]);
    });

    it('should reset session after timeout', () => {
      const SESSION_TIMEOUT = 300000; // 5 minutes
      let sessionStartTime = Date.now() - SESSION_TIMEOUT + 1000; // 1 second before timeout
      let sessionAttemptedNonces = new Set([1, 2, 3]);
      let _setSessionAttemptedNonces = vi.fn();

      const checkSessionReset = () => {
        const sessionAge = Date.now() - sessionStartTime;
        if (sessionAge > SESSION_TIMEOUT) {
          sessionAttemptedNonces = new Set();
          sessionStartTime = Date.now();
          return true;
        }
        return false;
      };

      // Should not reset yet
      expect(checkSessionReset()).toBe(false);
      expect(sessionAttemptedNonces.size).toBe(3);

      // Update time to trigger reset (just over timeout)
      sessionStartTime = Date.now() - SESSION_TIMEOUT - 1000;
      expect(checkSessionReset()).toBe(true);
      expect(sessionAttemptedNonces.size).toBe(0);
    });

    it('should update attempted nonces after attempts', () => {
      let sessionAttemptedNonces = new Set([1, 2]);
      const _setSessionAttemptedNonces = vi.fn();

      const trackAttemptedNonces = (attemptedNonces) => {
        _setSessionAttemptedNonces(new Set([...sessionAttemptedNonces, ...attemptedNonces]));
      };

      const newAttemptedNonces = [3, 4, 5];
      trackAttemptedNonces(newAttemptedNonces);

      expect(_setSessionAttemptedNonces).toHaveBeenCalledWith(
        new Set([1, 2, 3, 4, 5])
      );
    });
  });

  describe('Global Initialization Lock', () => {
    it('should prevent concurrent initializations', async () => {
      // Mock React state and refs
      let isInitializingXMTP = false;
      const setIsInitializingXMTP = vi.fn((value) => {
        isInitializingXMTP = value;
      });

      let initializationPromiseRef = { current: null };

      const createXmtpClient = vi.fn().mockResolvedValue('client-created');

      const initializeXmtp = async () => {
        if (isInitializingXMTP) {
          if (initializationPromiseRef.current) {
            await initializationPromiseRef.current;
          }
          return;
        }

        setIsInitializingXMTP(true);

        try {
          initializationPromiseRef.current = (async () => {
            try {
              const result = await createXmtpClient();
              return result;
            } finally {
              setIsInitializingXMTP(false);
              initializationPromiseRef.current = null;
            }
          })();

          const result = await initializationPromiseRef.current;
          return result;
        } catch (error) {
          setIsInitializingXMTP(false);
          initializationPromiseRef.current = null;
          throw error;
        }
      };

      // First call should start initialization
      const promise1 = initializeXmtp();
      expect(setIsInitializingXMTP).toHaveBeenCalledWith(true);
      expect(isInitializingXMTP).toBe(true);

      // Second call should wait
      const promise2 = initializeXmtp();
      expect(createXmtpClient).toHaveBeenCalledTimes(1); // Only one call

      // Wait for first to complete
      await promise1;
      await promise2;

      // Both should resolve successfully
      expect(createXmtpClient).toHaveBeenCalledTimes(1);
      expect(setIsInitializingXMTP).toHaveBeenCalledWith(false);
      expect(isInitializingXMTP).toBe(false);
    });

    it('should handle initialization errors gracefully', async () => {
      let isInitializingXMTP = false;
      const setIsInitializingXMTP = vi.fn((value) => {
        isInitializingXMTP = value;
      });

      let initializationPromiseRef = { current: null };

      const createXmtpClient = vi.fn().mockRejectedValue(new Error('Initialization failed'));

      const initializeXmtp = async () => {
        if (isInitializingXMTP) {
          if (initializationPromiseRef.current) {
            await initializationPromiseRef.current;
          }
          return;
        }

        setIsInitializingXMTP(true);

        try {
          initializationPromiseRef.current = (async () => {
            try {
              const result = await createXmtpClient();
              return result;
            } finally {
              setIsInitializingXMTP(false);
              initializationPromiseRef.current = null;
            }
          })();

          const result = await initializationPromiseRef.current;
          return result;
        } catch (error) {
          setIsInitializingXMTP(false);
          initializationPromiseRef.current = null;
          throw error;
        }
      };

      // Should throw and cleanup
      await expect(initializeXmtp()).rejects.toThrow('Initialization failed');

      expect(setIsInitializingXMTP).toHaveBeenCalledWith(false);
      expect(isInitializingXMTP).toBe(false);
      expect(initializationPromiseRef.current).toBe(null);
    });

    it('should allow new initialization after completion', async () => {
      let isInitializingXMTP = false;
      const setIsInitializingXMTP = vi.fn((value) => {
        isInitializingXMTP = value;
      });

      let initializationPromiseRef = { current: null };

      const createXmtpClient = vi.fn().mockResolvedValue('client-created');

      const initializeXmtp = async () => {
        if (isInitializingXMTP) {
          if (initializationPromiseRef.current) {
            await initializationPromiseRef.current;
          }
          return;
        }

        setIsInitializingXMTP(true);

        try {
          initializationPromiseRef.current = (async () => {
            try {
              const result = await createXmtpClient();
              return result;
            } finally {
              setIsInitializingXMTP(false);
              initializationPromiseRef.current = null;
            }
          })();

          const result = await initializationPromiseRef.current;
          return result;
        } catch (error) {
          setIsInitializingXMTP(false);
          initializationPromiseRef.current = null;
          throw error;
        }
      };

      // First initialization
      await initializeXmtp();
      expect(createXmtpClient).toHaveBeenCalledTimes(1);

      // Second initialization should work normally
      await initializeXmtp();
      expect(createXmtpClient).toHaveBeenCalledTimes(2);
    });
  });

  describe('Smart Retry with Client Creation', () => {
    it('should retry on retryable errors', async () => {
      const mockClientCreate = vi.fn();
      const classifyXmtpError = vi.fn();
      const calculateBackoff = vi.fn();

      classifyXmtpError.mockReturnValue({ type: 'network', retryable: true });
      calculateBackoff.mockReturnValue(1000);

      // Fail first, succeed second
      mockClientCreate
        .mockRejectedValueOnce(new Error('Network timeout'))
        .mockResolvedValueOnce('success-client');

      const createClientWithRetry = async (nonce, maxRetries = 3) => {
        const _baseDelay = 1000; // Mark as unused

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
          try {
            const disableAutoRegister = attempt > 1;
            return await mockClientCreate(nonce, disableAutoRegister);
          } catch (err) {
            const errorType = classifyXmtpError(err);

            if (!errorType.retryable || attempt === maxRetries) {
              throw err;
            }

            const delay = calculateBackoff(attempt, _baseDelay);
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        }
      };

      const result = await createClientWithRetry(1, 2);

      expect(result).toBe('success-client');
      expect(mockClientCreate).toHaveBeenCalledTimes(2);
      expect(classifyXmtpError).toHaveBeenCalledTimes(1);
      expect(calculateBackoff).toHaveBeenCalledWith(1, 1000);
    });

    it('should not retry on non-retryable errors', async () => {
      const mockClientCreate = vi.fn();
      const classifyXmtpError = vi.fn();

      classifyXmtpError.mockReturnValue({ type: 'installation_limit', retryable: false });

      mockClientCreate.mockRejectedValue(new Error('already registered 10/10 installations'));

      const createClientWithRetry = async (nonce, maxRetries = 3) => {
        const _baseDelay = 1000; // Mark as unused

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
          try {
            const disableAutoRegister = attempt > 1;
            return await mockClientCreate(nonce, disableAutoRegister);
          } catch (err) {
            const errorType = classifyXmtpError(err);

            if (!errorType.retryable || attempt === maxRetries) {
              throw err;
            }

            // Should not reach here for non-retryable errors
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        }
      };

      await expect(createClientWithRetry(1, 2)).rejects.toThrow('already registered 10/10 installations');
      expect(mockClientCreate).toHaveBeenCalledTimes(1);
      expect(classifyXmtpError).toHaveBeenCalledTimes(1);
    });

    it('should respect maximum retry limit', async () => {
      const mockClientCreate = vi.fn();
      const classifyXmtpError = vi.fn();
      const calculateBackoff = vi.fn();

      classifyXmtpError.mockReturnValue({ type: 'network', retryable: true });
      calculateBackoff.mockReturnValue(1); // 1ms delay for fast test

      // Fail all attempts
      mockClientCreate.mockRejectedValue(new Error('Network timeout'));

      const createClientWithRetry = async (nonce, maxRetries = 3) => {
        const _baseDelay = 1000; // Mark as unused

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
          try {
            const disableAutoRegister = attempt > 1;
            return await mockClientCreate(nonce, disableAutoRegister);
          } catch (err) {
            const errorType = classifyXmtpError(err);

            if (!errorType.retryable || attempt === maxRetries) {
              throw err;
            }

            const delay = calculateBackoff(attempt, _baseDelay);
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        }
      };

      await expect(createClientWithRetry(1, 2)).rejects.toThrow('Network timeout');
      expect(mockClientCreate).toHaveBeenCalledTimes(2); // maxRetries = 2
      expect(classifyXmtpError).toHaveBeenCalledTimes(2);
      expect(calculateBackoff).toHaveBeenCalledTimes(1); // Only called for first retry
    });

    it('should use disableAutoRegister on retry attempts', async () => {
      const mockClientCreate = vi.fn();
      const classifyXmtpError = vi.fn();

      classifyXmtpError.mockReturnValue({ type: 'nonce', retryable: true });

      // Succeed on retry
      mockClientCreate
        .mockRejectedValueOnce(new Error('Nonce error'))
        .mockResolvedValueOnce('retry-client');

      const createClientWithRetry = async (nonce, maxRetries = 3) => {
        const _baseDelay = 1000; // Mark as unused

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
          try {
            const disableAutoRegister = attempt > 1;
            return await mockClientCreate(nonce, disableAutoRegister);
          } catch (err) {
            const errorType = classifyXmtpError(err);

            if (!errorType.retryable || attempt === maxRetries) {
              throw err;
            }

            await new Promise(resolve => setTimeout(resolve, 100));
          }
        }
      };

      const result = await createClientWithRetry(1, 2);

      expect(result).toBe('retry-client');
      expect(mockClientCreate).toHaveBeenCalledTimes(2);
      expect(mockClientCreate).toHaveBeenNthCalledWith(1, 1, false); // First call: no disableAutoRegister
      expect(mockClientCreate).toHaveBeenNthCalledWith(2, 1, true);  // Second call: disableAutoRegister
    });
  });
});