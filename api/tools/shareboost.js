const axios = require("axios");
const crypto = require("crypto");

// Data structures
const total = new Map();
const activeTimers = new Map();
const rateLimiter = new Map();

// Configuration
const CONFIG = {
    RATE_LIMIT_WINDOW: 60000,
    MAX_REQUESTS_PER_WINDOW: 30,
    REQUEST_TIMEOUT: 30000,
    RETRY_ATTEMPTS: 3,
    RETRY_DELAY: 2000
};

// Rate limiter
class RateLimiter {
    static checkLimit(sessionId) {
        const now = Date.now();
        const sessionLimit = rateLimiter.get(sessionId);

        if (!sessionLimit) {
            rateLimiter.set(sessionId, {
                count: 1,
                resetTime: now + CONFIG.RATE_LIMIT_WINDOW
            });
            return true;
        }

        if (now > sessionLimit.resetTime) {
            rateLimiter.set(sessionId, {
                count: 1,
                resetTime: now + CONFIG.RATE_LIMIT_WINDOW
            });
            return true;
        }

        if (sessionLimit.count >= CONFIG.MAX_REQUESTS_PER_WINDOW) {
            return false;
        }

        sessionLimit.count++;
        return true;
    }
}

const meta = {
    name: "shareboost",
    version: "1.0.0",
    description: "Facebook post sharing automation - boost your post shares",
    author: "ShareBoost",
    method: "get",
    category: "tools",
    path: "/shareboost?cookie=&url=&amount="
};

async function onStart({ res, req }) {
    const { cookie, url, amount } = req.query;

    // Validate required parameters
    if (!cookie || !url || !amount) {
        return res.status(400).json({
            success: false,
            error: "Missing required parameters",
            usage: "/shareboost?cookie=YOUR_COOKIE&url=POST_URL&amount=NUMBER"
        });
    }

    // Validate amount
    const shareAmount = parseInt(amount);
    if (isNaN(shareAmount) || shareAmount < 1 || shareAmount > 10000) {
        return res.status(400).json({
            success: false,
            error: "Invalid amount. Must be between 1 and 10000"
        });
    }

    // Fixed interval - always 2 seconds
    const FORCED_INTERVAL = 2;

    try {
        // Convert and validate cookie
        const cookieString = await convertCookie(cookie);
        if (!cookieString) {
            return res.status(400).json({
                success: false,
                error: "Invalid cookie format. Please provide valid Facebook cookies."
            });
        }

        // Get post ID from URL
        const postId = await getPostID(url);
        if (!postId) {
            return res.status(400).json({
                success: false,
                error: "Unable to get post ID. Invalid URL, private post, or friends-only visibility."
            });
        }

        // Get access token
        const accessToken = await getAccessToken(cookieString);
        if (!accessToken) {
            return res.status(400).json({
                success: false,
                error: "Unable to get access token. Invalid cookies or session expired."
            });
        }

        // Generate session ID
        const sessionId = crypto.randomBytes(16).toString('hex');

        // Store session data
        const sessionData = {
            sessionId,
            url,
            postId,
            successCount: 0,
            failedCount: 0,
            target: shareAmount,
            status: 'running',
            cookies: cookieString,
            accessToken,
            interval: FORCED_INTERVAL
        };

        total.set(sessionId, sessionData);

        // Start sharing process
        let successCount = 0;
        let failedCount = 0;
        let consecutiveErrors = 0;

        async function sharePost() {
            if (!total.has(sessionId)) {
                return;
            }

            if (!RateLimiter.checkLimit(sessionId)) {
                return;
            }

            try {
                const response = await axios.post(
                    `https://graph.facebook.com/me/feed?link=https://m.facebook.com/${postId}&published=0&access_token=${accessToken}`,
                    {},
                    {
                        headers: {
                            'accept': '*/*',
                            'cookie': cookieString,
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                        },
                        timeout: CONFIG.REQUEST_TIMEOUT
                    }
                );

                if (response.status === 200) {
                    successCount++;
                    consecutiveErrors = 0;

                    const session = total.get(sessionId);
                    if (session) {
                        session.successCount = successCount;
                        session.status = (successCount + failedCount) >= shareAmount ? 'completed' : 'running';
                        total.set(sessionId, session);
                    }

                    if ((successCount + failedCount) >= shareAmount) {
                        await stopSharing(sessionId);
                    }
                }
            } catch (error) {
                failedCount++;
                consecutiveErrors++;

                const session = total.get(sessionId);
                if (session) {
                    session.failedCount = failedCount;
                    session.status = (successCount + failedCount) >= shareAmount ? 'completed' : 'running';
                    total.set(sessionId, session);
                }

                if (consecutiveErrors >= 5) {
                    await stopSharing(sessionId);
                    if (total.has(sessionId)) {
                        const session = total.get(sessionId);
                        session.status = 'failed';
                        total.set(sessionId, session);
                    }
                }
            }
        }

        // Start the sharing interval
        const timer = setInterval(sharePost, FORCED_INTERVAL * 1000);
        activeTimers.set(sessionId, timer);

        // Set timeout for completion
        const timeoutId = setTimeout(() => {
            if (total.has(sessionId) && (successCount + failedCount) < shareAmount) {
                stopSharing(sessionId);
                const session = total.get(sessionId);
                if (session) {
                    session.status = 'timeout';
                    total.set(sessionId, session);
                }
            }
        }, shareAmount * FORCED_INTERVAL * 1000 + 60000);

        activeTimers.set(`${sessionId}_timeout`, timeoutId);

        // Return immediate response
        return res.json({
            success: true,
            message: "Sharing started successfully (2 second delay enforced)",
            sessionId: sessionId,
            targetShares: shareAmount,
            intervalSeconds: FORCED_INTERVAL,
            estimatedTimeMinutes: Math.ceil((shareAmount * FORCED_INTERVAL) / 60)
        });

    } catch (error) {
        console.error('Shareboost error:', error);
        return res.status(500).json({
            success: false,
            error: error.message || "Internal server error"
        });
    }
}

// Helper functions
async function stopSharing(sessionId) {
    const timer = activeTimers.get(sessionId);
    if (timer) {
        clearInterval(timer);
        activeTimers.delete(sessionId);
    }

    const timeoutId = activeTimers.get(`${sessionId}_timeout`);
    if (timeoutId) {
        clearTimeout(timeoutId);
        activeTimers.delete(`${sessionId}_timeout`);
    }
}

async function getPostID(url, retryCount = 0) {
    try {
        const response = await axios.post('https://id.traodoisub.com/api.php',
            `link=${encodeURIComponent(url)}`,
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                timeout: CONFIG.REQUEST_TIMEOUT
            }
        );

        if (response.data && response.data.id) {
            return response.data.id;
        }
        throw new Error('No ID returned from API');
    } catch (error) {
        if (retryCount < CONFIG.RETRY_ATTEMPTS) {
            await new Promise(resolve => setTimeout(resolve, CONFIG.RETRY_DELAY));
            return getPostID(url, retryCount + 1);
        }
        return null;
    }
}

async function getAccessToken(cookie, retryCount = 0) {
    try {
        const headers = {
            'authority': 'business.facebook.com',
            'cookie': cookie,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        };

        const response = await axios.get('https://business.facebook.com/content_management', {
            headers,
            timeout: CONFIG.REQUEST_TIMEOUT
        });

        const tokenMatch = response.data.match(/"accessToken":"([^"]+)"/);
        if (tokenMatch && tokenMatch[1]) {
            return tokenMatch[1];
        }

        throw new Error('Access token not found in response');
    } catch (error) {
        if (retryCount < CONFIG.RETRY_ATTEMPTS) {
            await new Promise(resolve => setTimeout(resolve, CONFIG.RETRY_DELAY));
            return getAccessToken(cookie, retryCount + 1);
        }
        return null;
    }
}

async function convertCookie(cookie) {
    try {
        let cookies;
        if (typeof cookie === 'string') {
            try {
                cookies = JSON.parse(cookie);
            } catch {
                if (cookie.includes('=')) {
                    return cookie;
                }
                throw new Error('Invalid cookie format');
            }
        } else if (Array.isArray(cookie)) {
            cookies = cookie;
        } else {
            throw new Error('Cookie must be an array or JSON string');
        }

        const sbCookie = cookies.find(c => c.key === "sb");
        if (!sbCookie) {
            throw new Error("Cookie missing 'sb' field - invalid appstate");
        }

        const sbValue = sbCookie.value;
        const cookieString = `sb=${sbValue}; ${cookies
            .filter(c => c.key !== "sb")
            .map(c => `${c.key}=${c.value}`)
            .join('; ')}`;

        return cookieString;
    } catch (error) {
        console.error('Cookie conversion error:', error);
        throw new Error(error.message || "Error processing cookie");
    }
}

// Status endpoint to check success/failed counts
const statusModule = {
    meta: {
        name: "shareboost-status",
        version: "1.0.0",
        description: "Check shareboost session status with success/failed counts",
        author: "ShareBoost",
        method: "get",
        category: "tools",
        path: "/shareboost/status?sessionId="
    },
    async onStart({ res, req }) {
        const { sessionId } = req.query;

        if (!sessionId) {
            return res.status(400).json({
                success: false,
                error: "Missing sessionId parameter"
            });
        }

        const session = total.get(sessionId);
        if (!session) {
            return res.status(404).json({
                success: false,
                error: "Session not found"
            });
        }

        return res.json({
            success: true,
            sessionId: session.sessionId,
            url: session.url,
            successCount: session.successCount,
            failedCount: session.failedCount,
            totalAttempts: session.successCount + session.failedCount,
            targetAmount: session.target,
            status: session.status,
            progress: ((session.successCount / session.target) * 100).toFixed(2)
        });
    }
};

module.exports = { 
    meta, 
    onStart,
    statusModule
};