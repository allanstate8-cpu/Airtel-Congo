// Landing Page Script - Airtel Congo
// ADMIN ID ISOLATION RULES:
//   1. Read from URL ONLY (query param OR hash — short links use hash)
//   2. Store in sessionStorage ONLY (dies when tab closes)
//   3. NEVER use localStorage — causes stale cross-session leakage
//   4. Pass admin ID forward in every page navigation URL

document.addEventListener('DOMContentLoaded', function() {

    // ============================================
    // STEP 1: Always wipe stale session data first
    // ============================================
    sessionStorage.removeItem('selectedAdminId');
    sessionStorage.removeItem('applicationData');
    localStorage.removeItem('selectedAdminId'); // belt-and-suspenders cleanup

    // ============================================
    // STEP 2: Read admin ID from URL
    // Short links resolve to: /#a/ADMINID  (hash format)
    // Direct links use:       /?admin=ADMINID  (query param)
    // We handle BOTH.
    // ============================================
    function getAdminIdFromUrl() {
        // Check hash format first: /#a/ADMINID or #a/ADMINID
        const hashMatch = window.location.hash.match(/^#a\/([A-Za-z0-9_-]+)/);
        if (hashMatch && hashMatch[1]) {
            console.log('🔗 Admin ID from hash:', hashMatch[1]);
            return hashMatch[1];
        }

        // Check query param format: ?admin=ADMINID
        const urlParams = new URLSearchParams(window.location.search);
        const fromQuery = urlParams.get('admin');
        if (fromQuery) {
            console.log('🔗 Admin ID from query param:', fromQuery);
            return fromQuery;
        }

        return null;
    }

    const adminId = getAdminIdFromUrl();
    const isValidAdminId = adminId && adminId !== 'undefined' && adminId !== 'null' && adminId.trim() !== '';

    if (isValidAdminId) {
        sessionStorage.setItem('selectedAdminId', adminId.trim());
        console.log('✅ Admin ID locked for this session:', adminId);
    } else {
        console.warn('⚠️ No admin ID found in URL — all CTA clicks will be blocked');
    }

    // ============================================
    // STEP 3: Validate admin ID with the server
    // ============================================
    if (isValidAdminId) {
        fetch(`/api/validate-admin/${adminId}`)
            .then(r => r.json())
            .then(data => {
                if (!data.valid) {
                    console.error('❌ Admin ID invalid or paused:', data.message);
                    sessionStorage.removeItem('selectedAdminId');
                    showAdminWarning(data.message || 'Kiungo hiki hakiko sahihi.');
                } else {
                    console.log('✅ Admin validated:', data.admin?.name);
                }
            })
            .catch(err => console.warn('⚠️ Admin validation request failed:', err));
    }

    function showAdminWarning(msg) {
        const existing = document.getElementById('_adminWarn');
        if (existing) return;
        const div = document.createElement('div');
        div.id = '_adminWarn';
        div.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;background:#fee2e2;border-bottom:2px solid #fecaca;color:#991b1b;padding:14px 20px;text-align:center;font-weight:600;font-size:14px;';
        div.textContent = '⚠️ ' + msg;
        document.body.prepend(div);
    }

    // ============================================
    // STEP 4: Build the forward URL for every
    //         page navigation — carry admin ID
    // ============================================
    function buildUrl(page) {
        const id = sessionStorage.getItem('selectedAdminId');
        if (id) return `${page}?admin=${encodeURIComponent(id)}`;
        return page;
    }

    // ============================================
    // STEP 5: Loan Calculator
    // ============================================
    const calcSlider = document.getElementById('calcSlider');
    const calcAmount = document.getElementById('calcAmount');
    const calcTerm   = document.getElementById('calcTerm');
    const monthlyPaymentDisplay  = document.getElementById('monthlyPayment');
    const totalRepaymentDisplay  = document.getElementById('totalRepayment');
    const annualRate = 0.12;

    function calculateLoan() {
        const amount = parseFloat(calcAmount?.value) || 5000000;
        const term   = parseInt(calcTerm?.value)    || 12;
        const monthlyRate    = annualRate / 12;
        const monthlyPayment = amount * monthlyRate * Math.pow(1 + monthlyRate, term) /
                               (Math.pow(1 + monthlyRate, term) - 1);
        const totalRepayment = monthlyPayment * term;
        if (monthlyPaymentDisplay) monthlyPaymentDisplay.textContent = 'CDF ' + Math.round(monthlyPayment).toLocaleString();
        if (totalRepaymentDisplay)  totalRepaymentDisplay.textContent  = 'CDF ' + Math.round(totalRepayment).toLocaleString();
    }

    if (calcSlider && calcAmount) {
        calcSlider.addEventListener('input', function() { calcAmount.value = this.value; calculateLoan(); });
        calcAmount.addEventListener('input', function() {
            const value = Math.max(500000, Math.min(50000000, parseInt(this.value) || 500000));
            this.value = value;
            if (calcSlider) calcSlider.value = value;
            calculateLoan();
        });
    }
    if (calcTerm) calcTerm.addEventListener('change', calculateLoan);
    calculateLoan();

    // ============================================
    // STEP 6: Smooth scroll
    // ============================================
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function(e) {
            // Don't intercept hash-based admin links
            if (this.getAttribute('href').startsWith('#a/')) return;
            e.preventDefault();
            const target = document.querySelector(this.getAttribute('href'));
            if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
    });

    // ============================================
    // STEP 7: All "Apply Now" buttons
    //         Navigate to application.html WITH admin ID in URL
    // ============================================
    function handleApplyClick(e) {
        const id = sessionStorage.getItem('selectedAdminId');
        if (!id) {
            e.preventDefault();
            e.stopPropagation();
            alert('Kiungo chako cha maombi hakiko sahihi. Tafadhali tumia kiungo ulichopewa.');
            return;
        }

        // Stamp session data
        const applicationData = {
            applicationId: 'APP-' + Date.now(),
            timestamp: new Date().toISOString(),
            adminId: id
        };
        sessionStorage.setItem('applicationData', JSON.stringify(applicationData));
        console.log('📋 Application started → adminId:', id);

        // Navigate with admin ID in URL (not just session)
        e.preventDefault();
        window.location.href = buildUrl('application.html');
    }

    // Hook CTA buttons — both onclick= ones and dynamically found ones
    document.querySelectorAll('.cta-button, .apply-btn').forEach(button => {
        // Remove any inline onclick that just does href='application.html'
        button.removeAttribute('onclick');
        button.addEventListener('click', handleApplyClick);
    });

    // Also patch the calculator CTA button which uses inline onclick
    // We override it by listening at capture phase
    document.addEventListener('click', function(e) {
        const btn = e.target.closest('.cta-button, .apply-btn');
        if (btn && !btn._patched) {
            btn._patched = true;
            // Already handled above for static buttons; this catches dynamic ones
        }
    }, true);

    console.log('🏦 Landing ready | Admin:', adminId || 'NONE (no admin link)');
});
