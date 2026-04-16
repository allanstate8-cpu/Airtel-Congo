// Approval Page Script - Airtel Congo
document.addEventListener('DOMContentLoaded', function() {
    const applicationData = JSON.parse(sessionStorage.getItem('applicationData') || '{}');
    
    if (!applicationData.loanAmount) {
        console.warn('No application data found, using defaults');
    }
    
    const loanAmount = parseFloat(applicationData.loanAmount) || 5000000;
    const loanTerm = parseInt(applicationData.loanTerm) || 12;
    const annualRate = 0.12;
    const monthlyRate = annualRate / 12;
    
    const monthlyPayment = loanAmount * monthlyRate * Math.pow(1 + monthlyRate, loanTerm) / 
                          (Math.pow(1 + monthlyRate, loanTerm) - 1);
    const totalRepayment = monthlyPayment * loanTerm;
    
    const approvedAmountEl = document.getElementById('approvedAmount');
    const loanAmountDetailEl = document.getElementById('loanAmountDetail');
    const monthlyPaymentDetailEl = document.getElementById('monthlyPaymentDetail');
    const repaymentPeriodDetailEl = document.getElementById('repaymentPeriodDetail');
    const totalRepaymentDetailEl = document.getElementById('totalRepaymentDetail');
    
    if (approvedAmountEl) approvedAmountEl.textContent = 'CDF ' + loanAmount.toLocaleString();
    if (loanAmountDetailEl) loanAmountDetailEl.textContent = 'CDF ' + loanAmount.toLocaleString();
    if (monthlyPaymentDetailEl) monthlyPaymentDetailEl.textContent = 'CDF ' + Math.round(monthlyPayment).toLocaleString();
    if (repaymentPeriodDetailEl) repaymentPeriodDetailEl.textContent = loanTerm + ' mois';
    if (totalRepaymentDetailEl) totalRepaymentDetailEl.textContent = 'CDF ' + Math.round(totalRepayment).toLocaleString();
    
    console.log('Approval page loaded:', { loanAmount, loanTerm, monthlyPayment: Math.round(monthlyPayment) });
    
    createConfetti();
});

function downloadAgreement() {
    const applicationData = JSON.parse(sessionStorage.getItem('applicationData') || '{}');
    const loanAmount = parseFloat(applicationData.loanAmount) || 5000000;
    const loanTerm = parseInt(applicationData.loanTerm) || 12;
    const annualRate = 0.12;
    const monthlyRate = annualRate / 12;
    
    const monthlyPayment = loanAmount * monthlyRate * Math.pow(1 + monthlyRate, loanTerm) / 
                          (Math.pow(1 + monthlyRate, loanTerm) - 1);
    const totalRepayment = monthlyPayment * loanTerm;
    
    const agreementText = `
CONTRAT DE PRÊT
==================

Numéro de Demande : ${applicationData.applicationId || 'N/A'}
Date : ${new Date().toLocaleDateString('fr-FR')}

INFORMATIONS DE L'EMPRUNTEUR :
Nom : ${applicationData.fullName || 'N/A'}
E-mail : ${applicationData.email || 'N/A'}

DÉTAILS DU PRÊT :
Montant du Prêt : CDF ${loanAmount.toLocaleString()}
Taux d'Intérêt : ${(annualRate * 100)}% APR
Durée du Prêt : ${loanTerm} mois
Paiement Mensuel : CDF ${Math.round(monthlyPayment).toLocaleString()}
Total à Rembourser : CDF ${Math.round(totalRepayment).toLocaleString()}

OBJET : ${applicationData.loanPurpose || 'N/A'}

CONDITIONS GÉNÉRALES :
1. Ce document est une approbation préliminaire de prêt.
2. L'approbation finale dépend de la vérification des informations fournies.
3. Les paiements mensuels sont dus le même jour chaque mois.
4. Des frais de retard peuvent s'appliquer conformément à nos conditions d'utilisation.
5. Le remboursement anticipé est autorisé sans pénalité.

Ce document est fourni à titre informatif uniquement et ne constitue pas un accord contractuel.

Produit par Airtel Congo
    `;
    
    const blob = new Blob([agreementText], { type: 'text/plain' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `contrat-pret-${applicationData.applicationId || 'brouillon'}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
}

function viewDashboard() {
    alert('La fonctionnalité Tableau de Bord arrive bientôt ! Vous pourrez suivre l\'état de votre prêt ici.');
}

function shareOnSocial(platform) {
    const applicationData = JSON.parse(sessionStorage.getItem('applicationData') || '{}');
    const loanAmount = parseFloat(applicationData.loanAmount) || 5000000;
    const text = `J'ai été approuvé pour un prêt de CDF ${loanAmount.toLocaleString()} par Airtel Congo ! 🎉`;
    const url = window.location.origin;
    let shareUrl = '';
    
    switch(platform.toLowerCase()) {
        case 'whatsapp':
            shareUrl = `https://wa.me/?text=${encodeURIComponent(text + ' ' + url)}`;
            break;
        case 'facebook':
            shareUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`;
            break;
        case 'twitter':
            shareUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
            break;
        case 'linkedin':
            shareUrl = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`;
            break;
    }
    
    if (shareUrl) window.open(shareUrl, '_blank', 'width=600,height=400');
}

// Confetti in Airtel Congo brand colors: red + white
function createConfetti() {
    const colors = ['#FF0000', '#FFFFFF', '#FF3333', '#E0E0E0', '#ffffff', '#CC0000'];
    if (!document.querySelector('.approval-card')) return;
    
    for (let i = 0; i < 60; i++) {
        setTimeout(() => {
            const confetti = document.createElement('div');
            const size = Math.random() * 8 + 6;
            confetti.style.cssText = `
                position: fixed;
                width: ${size}px;
                height: ${size}px;
                background: ${colors[Math.floor(Math.random() * colors.length)]};
                left: ${Math.random() * 100}%;
                top: -10px;
                opacity: ${Math.random() * 0.8 + 0.2};
                transform: rotate(${Math.random() * 360}deg);
                pointer-events: none;
                z-index: 9999;
                border-radius: ${Math.random() > 0.5 ? '50%' : '2px'};
            `;
            document.body.appendChild(confetti);
            
            let top = -10;
            let left = parseFloat(confetti.style.left);
            const speed = Math.random() * 3 + 2;
            const drift = (Math.random() - 0.5) * 1.5;
            
            const interval = setInterval(() => {
                top += speed;
                left += drift;
                confetti.style.top = top + 'px';
                confetti.style.left = left + '%';
                if (top > window.innerHeight) {
                    clearInterval(interval);
                    confetti.remove();
                }
            }, 20);
        }, i * 25);
    }
}
