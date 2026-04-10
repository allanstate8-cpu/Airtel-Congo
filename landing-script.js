// Landing Page Script - Airtel Congo
// RULE: Admin ID ONLY comes from the URL. Never from localStorage.
// localStorage is completely removed to prevent stale admin ID leakage.

document.addEventListener('DOMContentLoaded', function() {

    // ============================================
    // STEP 1: Read admin ID from URL ONLY
    // ============================================
    const urlParams = new URLSearchParams(window.location.search);
    const adminIdFromUrl = urlParams.get('admin');

    // Always clear any previously stored admin ID first
    sessionStorage.removeItem('selectedAdminId');
    localStorage.removeItem('selectedAdminId');
    sessionStorage.removeItem('applicationData');

    if (adminIdFromUrl && adminIdFromUrl !== 'undefined' && adminIdFromUrl !== 'null' && adminIdFromUrl !== '') {
        // Store ONLY in sessionStorage (dies when tab closes — safe)
        sessionStorage.setItem('selectedAdminId', adminIdFromUrl);
        console.log('✅ Admin ID from URL:', adminIdFromUrl);
    } else {
        console.log('⚠️ No admin ID in URL — auto-assign mode');
    }

    // ============================================
    // LOAN CALCULATOR
    // ============================================
    const calcSlider = document.getElementById('calcSlider');
    const calcAmount = document.getElementById('calcAmount');
    const calcTerm = document.getElementById('calcTerm');
    const monthlyPaymentDisplay = document.getElementById('monthlyPayment');
    const totalRepaymentDisplay = document.getElementById('totalRepayment');
    const annualRate = 0.12;

    function calculateLoan() {
        const amount = parseFloat(calcAmount?.value) || 5000000;
        const term = parseInt(calcTerm?.value) || 12;
        const monthlyRate = annualRate / 12;
        const monthlyPayment = amount * monthlyRate * Math.pow(1 + monthlyRate, term) /
                              (Math.pow(1 + monthlyRate, term) - 1);
        const totalRepayment = monthlyPayment * term;
        if (monthlyPaymentDisplay) monthlyPaymentDisplay.textContent = 'CDF ' + Math.round(monthlyPayment).toLocaleString();
        if (totalRepaymentDisplay) totalRepaymentDisplay.textContent = 'CDF ' + Math.round(totalRepayment).toLocaleString();
    }

    if (calcSlider && calcAmount) {
        calcSlider.addEventListener('input', function() { calcAmount.value = this.value; calculateLoan(); });
        calcAmount.addEventListener('input', function() {
            const value = Math.max(500000, Math.min(50000000, this.value || 500000));
            this.value = value;
            calcSlider.value = value;
            calculateLoan();
        });
    }
    if (calcTerm) calcTerm.addEventListener('change', calculateLoan);
    calculateLoan();

    // ============================================
    // SMOOTH SCROLL
    // ============================================
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function(e) {
            e.preventDefault();
            const target = document.querySelector(this.getAttribute('href'));
            if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
    });

    // ============================================
    // APPLY NOW — stamp admin ID into session data
    // ============================================
    document.querySelectorAll('.cta-button, .apply-btn').forEach(button => {
        button.addEventListener('click', function() {
            const adminId = sessionStorage.getItem('selectedAdminId') || null;
            const applicationData = {
                applicationId: 'APP-' + Date.now(),
                timestamp: new Date().toISOString(),
                adminId: adminId
            };
            sessionStorage.setItem('applicationData', JSON.stringify(applicationData));
            console.log('📋 Application started, adminId:', adminId || 'auto-assign');
        });
    });

    console.log('🏦 Landing ready | Admin from URL:', adminIdFromUrl || 'NONE');
});
