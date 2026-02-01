// Configuration Firebase
    const firebaseConfig = {
        databaseURL: "https://bde-ski-default-rtdb.europe-west1.firebasedatabase.app/"
    };

    // Variables globales
    const savingsMap = {
        17.5: 5.55,
        10: 3.1,
        29.5: 9.47,
        35: 11.1,
        20: 6.2,
        57: 18.62,
        19.5: 6.37,
        37: 11.92
    };

    let currentApp = null;
    let database = null;
    let authToken = null;
    let students = [];
    let editIndex = null;
    let currentSearch = '';
    let currentChallengeId = null;
    let currentResponseHash = null;

    // Initialiser Firebase
    function initializeFirebase(appName = 'default') {
        try {
            return firebase.initializeApp(firebaseConfig, appName);
        } catch (error) {
            return firebase.app(appName);
        }
    }

    // Nettoyer une instance Firebase
    function cleanupFirebaseApp(app) {
        if (app && typeof app.delete === 'function') {
            try {
                app.delete();
                return true;
            } catch (e) {
                return false;
            }
        }
        return false;
    }

    // Fonction SHA256
    async function sha256(message) {
        const msgBuffer = new TextEncoder().encode(message);
        const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }

    // Générer un ID unique
    function generateId() {
        return Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }

    // Nettoyer les données d'authentification dans Firebase
    async function cleanupAuthData(responseHash, challengeId) {
        let cleanupDb = null;
        
        try {
            // Créer une instance temporaire pour le nettoyage
            const tempApp = initializeFirebase('cleanup_' + Date.now());
            cleanupDb = tempApp.database();
            
            // Nettoyer la réponse
            if (responseHash) {
                await cleanupDb.ref(`valid_responses/${responseHash}`).remove();
            }
            
            // Nettoyer le challenge
            if (challengeId) {
                await cleanupDb.ref(`challenges/${challengeId}`).remove();
            }
            
            // Nettoyer l'instance temporaire
            cleanupFirebaseApp(tempApp);
            
        } catch (error) {
            // Ignorer les erreurs de nettoyage (les données peuvent déjà être nettoyées)
        } finally {
            if (cleanupDb && cleanupDb.app) {
                cleanupFirebaseApp(cleanupDb.app);
            }
        }
    }

    // Authentification
    async function authenticateWithCode(code) {
        const authButton = document.getElementById('authButton');
        const errorDiv = document.getElementById('authError');
        
        if (code.length !== 4 || !/^\d{4}$/.test(code)) {
            showAuthError('Le code doit contenir exactement 4 chiffres');
            return null;
        }
        
        let tempApp = null;
        
        try {
            authButton.classList.add('loading');
            authButton.disabled = true;
            authButton.innerHTML = '<i class="fas fa-spinner"></i> Vérification...';
            
            // Nettoyer l'instance précédente si elle existe
            if (currentApp) {
                cleanupFirebaseApp(currentApp);
            }
            
            // 1. Initialiser Firebase temporairement
            tempApp = initializeFirebase('temp_auth_' + Date.now());
            const tempDb = tempApp.database();
            
            // 2. Lire la clé publique
            const accessSnapshot = await tempDb.ref('access_control').once('value');
            
            if (!accessSnapshot.exists()) {
                throw new Error('Configuration manquante dans la base de données');
            }
            
            const publicKey = accessSnapshot.val().public_key;
            const codeHash = await sha256(code);
            
            if (codeHash !== publicKey) {
                throw new Error('Code incorrect');
            }
            
            // 3. Générer et sauvegarder le challenge
            currentChallengeId = generateId();
            const challenge = generateId();
            
            await tempDb.ref(`challenges/${currentChallengeId}`).set({
                challenge: challenge,
                timestamp: Date.now()
            });
            
            // 4. Calculer et sauvegarder la réponse
            const response = await sha256(code + challenge);
            currentResponseHash = await sha256(response);
            
            await tempDb.ref(`valid_responses/${currentResponseHash}`).set({
                challengeId: currentChallengeId,
                response: response,
                timestamp: Date.now()
            });
            
            // 5. Stocker le token localement
            authToken = currentResponseHash;
            localStorage.setItem('authToken', authToken);
            localStorage.setItem('challengeId', currentChallengeId);
            localStorage.setItem('responseHash', currentResponseHash);
            
            // 6. Nettoyer l'instance temporaire
            cleanupFirebaseApp(tempApp);
            tempApp = null;
            
            // 7. Créer l'instance principale
            currentApp = initializeFirebase('main_app_' + Date.now());
            database = currentApp.database();
            
            return authToken;
            
        } catch (error) {
            console.error('Erreur d\'authentification:', error);
            
            // Nettoyer en cas d'erreur
            if (tempApp) {
                cleanupFirebaseApp(tempApp);
            }
            
            if (error.message.includes('PERMISSION_DENIED') || 
                error.message.includes('permission-denied')) {
                showAuthError('Code incorrect ou accès refusé');
            } else if (error.message.includes('Configuration manquante')) {
                showAuthError('Erreur de configuration de la base de données');
            } else if (error.message.includes('Code incorrect')) {
                showAuthError('Code incorrect');
            } else {
                showAuthError('Erreur de connexion');
            }
            
            return null;
        } finally {
            authButton.classList.remove('loading');
            authButton.disabled = false;
            authButton.innerHTML = '<i class="fas fa-lock"></i> Accéder';
        }
    }

    // Afficher une erreur d'authentification
    function showAuthError(message) {
        const errorDiv = document.getElementById('authError');
        const input = document.getElementById('authCode');
        
        errorDiv.textContent = message;
        input.classList.add('error');
        
        setTimeout(() => {
            input.classList.remove('error');
            errorDiv.textContent = '';
        }, 5000);
    }

    // Vérifier l'authentification au chargement
    async function checkExistingAuth() {
        const savedToken = localStorage.getItem('authToken');
        const savedChallengeId = localStorage.getItem('challengeId');
        const savedResponseHash = localStorage.getItem('responseHash');
        
        if (!savedToken || !savedChallengeId || !savedResponseHash) {
            return false;
        }
        
        try {
            // Nettoyer l'instance précédente si elle existe
            if (currentApp) {
                cleanupFirebaseApp(currentApp);
            }
            
            // Initialiser avec le token sauvegardé
            currentApp = initializeFirebase('existing_session_' + Date.now());
            database = currentApp.database();
            authToken = savedToken;
            currentChallengeId = savedChallengeId;
            currentResponseHash = savedResponseHash;
            
            // Tester la connexion
            await database.ref('students').limitToFirst(1).once('value');
            
            return true;
        } catch (error) {
            console.error('Session invalide:', error);
            
            // En cas d'erreur, nettoyer le localStorage
            localStorage.removeItem('authToken');
            localStorage.removeItem('challengeId');
            localStorage.removeItem('responseHash');
            
            if (currentApp) {
                cleanupFirebaseApp(currentApp);
                currentApp = null;
            }
            
            return false;
        }
    }

    // Démarrer la session
    function startSession() {
        document.getElementById('authOverlay').style.display = 'none';
        document.getElementById('appContainer').style.display = 'block';
        document.getElementById('logoutBtn').style.display = 'flex';
        document.getElementById('sessionTimer').style.display = 'none'; // Cacher le timer
        
        loadStudents();
        document.getElementById('searchInput').focus();
    }

    // Déconnexion avec nettoyage complet
    async function logout() {
        // Récupérer les IDs avant de nettoyer le localStorage
        const challengeId = currentChallengeId || localStorage.getItem('challengeId');
        const responseHash = currentResponseHash || localStorage.getItem('responseHash');
        
        // Nettoyer les données dans Firebase
        await cleanupAuthData(responseHash, challengeId);
        
        // Nettoyer le localStorage
        localStorage.removeItem('authToken');
        localStorage.removeItem('challengeId');
        localStorage.removeItem('responseHash');
        
        // Nettoyer l'instance Firebase
        if (currentApp) {
            cleanupFirebaseApp(currentApp);
            currentApp = null;
        }
        
        // Réinitialiser les variables
        database = null;
        authToken = null;
        currentChallengeId = null;
        currentResponseHash = null;
        students = [];
        
        // Réafficher l'écran d'authentification
        document.getElementById('authOverlay').style.display = 'flex';
        document.getElementById('appContainer').style.display = 'none';
        document.getElementById('logoutBtn').style.display = 'none';
        document.getElementById('authCode').value = '';
        document.getElementById('authCode').focus();
        
        // Réinitialiser l'interface
        document.getElementById('studentsBody').innerHTML = '';
        document.getElementById('emptyState').style.display = 'block';
        updateStats();
    }

    // Nettoyage automatique à la fermeture de la page
    function setupBeforeUnload() {
        window.addEventListener('beforeunload', async function(event) {
            // Nettoyer les données d'authentification
            const challengeId = localStorage.getItem('challengeId');
            const responseHash = localStorage.getItem('responseHash');
            
            if (challengeId || responseHash) {
                // Utiliser sendBeacon pour un nettoyage asynchrone
                const data = new FormData();
                data.append('challengeId', challengeId || '');
                data.append('responseHash', responseHash || '');
                
                // Note: Pour un vrai nettoyage, il faudrait une API backend
                // Ici on nettoie en synchrone
                try {
                    const tempApp = initializeFirebase('cleanup_beforeunload_' + Date.now());
                    const cleanupDb = tempApp.database();
                    
                    if (responseHash) {
                        cleanupDb.ref(`valid_responses/${responseHash}`).remove().catch(() => {});
                    }
                    if (challengeId) {
                        cleanupDb.ref(`challenges/${challengeId}`).remove().catch(() => {});
                    }
                    
                    // Pas besoin d'attendre, on laisse Firebase faire le travail
                    setTimeout(() => {
                        cleanupFirebaseApp(tempApp);
                    }, 100);
                } catch (e) {
                    // Ignorer les erreurs
                }
            }
        });
    }

    // Fonctions utilitaires
    function formatCurrency(amount) {
        return amount.toFixed(2).replace('.', ',') + '€';
    }

    function calculateSavings(total) {
        return savingsMap[total] || 0;
    }

    // Gestion des données
    async function loadStudents() {
        if (!database) {
            showMessage('Base de données non connectée', 'error');
            return;
        }
        
        const loadingElement = document.getElementById('loadingData');
        if (loadingElement) {
            loadingElement.style.display = 'block';
        }
        
        try {
            const studentsRef = database.ref('students');
            const snapshot = await studentsRef.once('value');
            
            if (snapshot.exists()) {
                const data = snapshot.val();
                students = Object.entries(data).map(([id, studentData]) => ({
                    id: id,
                    ...studentData
                }));
            } else {
                students = [];
            }
            
            updateStudentList();
        } catch (error) {
            console.error('Erreur de chargement:', error);
            if (error.code === 'PERMISSION_DENIED') {
                showMessage('Session expirée. Veuillez vous reconnecter.', 'error');
                logout();
            } else {
                showMessage('Erreur de chargement des données: ' + error.message, 'error');
            }
        } finally {
            if (loadingElement) {
                loadingElement.style.display = 'none';
            }
        }
    }

    function filterStudents() {
        const searchTerm = currentSearch.toLowerCase();
        return students.filter(student => 
            (student.lastName && student.lastName.toLowerCase().includes(searchTerm)) ||
            (student.firstName && student.firstName.toLowerCase().includes(searchTerm)) ||
            (student.class && student.class.toLowerCase().includes(searchTerm))
        );
    }

    function updateStudentList() {
        const tbody = document.getElementById('studentsBody');
        const emptyState = document.getElementById('emptyState');
        const filteredStudents = filterStudents();
        
        if (filteredStudents.length === 0) {
            if (tbody) tbody.innerHTML = '';
            if (emptyState) emptyState.style.display = 'block';
            updateStats();
            return;
        }
        
        if (emptyState) emptyState.style.display = 'none';
        if (tbody) tbody.innerHTML = '';
        
        let totalAmount = 0;
        let totalSavings = 0;
        
        filteredStudents.forEach((student) => {
            const forfaitPrice = (student.forfaitDays || 0) * 17.5;
            const locationPrice = (student.locationDays || 0) * 10;
            const keycardPrice = (student.keycard || 0) * 2;
            const total = forfaitPrice + locationPrice + keycardPrice;
            const savings = calculateSavings(total);
            const realTotal = total - savings;
            
            totalAmount += total;
            totalSavings += savings;
            
            const row = document.createElement('tr');
            row.innerHTML = `
                <td><strong>${student.lastName || ''}</strong></td>
                <td>${student.firstName || ''}</td>
                <td><span class="badge">${student.class || ''}</span></td>
                <td class="amount-cell">${student.forfaitDays || 0}j</td>
                <td class="amount-cell">${student.locationDays || 0}j</td>
                <td class="amount-cell">${student.keycard ? 'Oui' : 'Non'}</td>
                <td class="amount-cell">${formatCurrency(total)}</td>
                <td class="amount-cell" style="color: var(--success);">${formatCurrency(savings)}</td>
                <td class="real-total">${formatCurrency(realTotal)}</td>
                <td>
                    <div class="action-buttons">
                        <button class="icon-btn" onclick="editStudent('${student.id}')" title="Modifier">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button class="icon-btn" onclick="deleteStudent('${student.id}')" title="Supprimer">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </td>
            `;
            if (tbody) tbody.appendChild(row);
        });
        
        updateStats(totalAmount, totalSavings);
    }

    function updateStats(totalAmount = 0, totalSavings = 0) {
        const totalStudentsElem = document.getElementById('totalStudents');
        const totalAmountElem = document.getElementById('totalAmount');
        const totalSavingsElem = document.getElementById('totalSavings');
        
        if (totalStudentsElem) totalStudentsElem.textContent = students.length;
        if (totalAmountElem) totalAmountElem.textContent = formatCurrency(totalAmount);
        if (totalSavingsElem) totalSavingsElem.textContent = formatCurrency(totalSavings);
    }

    async function addOrUpdateStudent() {
        if (!database) {
            showMessage('Non authentifié', 'error');
            return;
        }
        
        const firstName = document.getElementById('firstName').value.trim();
        const lastName = document.getElementById('lastName').value.trim();
        const studentClass = document.getElementById('class').value.trim().toUpperCase();
        const forfaitDays = parseInt(document.getElementById('forfaitDays').value) || 0;
        const locationDays = parseInt(document.getElementById('locationDays').value) || 0;
        const keycard = parseInt(document.getElementById('keycard').value) || 0;
        
        if (!firstName || !lastName || !studentClass) {
            showMessage('Veuillez remplir tous les champs', 'error');
            return;
        }
        
        if (studentClass.length !== 3) {
            showMessage('La classe doit contenir 3 caractères (ex: 203, TG1)', 'error');
            return;
        }
        
        const studentData = {
            firstName,
            lastName,
            class: studentClass,
            forfaitDays,
            locationDays,
            keycard,
            updatedAt: Date.now()
        };
        
        try {
            if (editIndex) {
                const studentRef = database.ref(`students/${editIndex}`);
                await studentRef.update(studentData);
                showMessage('Élève mis à jour avec succès', 'success');
                editIndex = null;
                document.getElementById('addBtn').innerHTML = '<i class="fas fa-plus"></i> Ajouter élève';
            } else {
                const newStudentRef = database.ref('students').push();
                await newStudentRef.set({
                    ...studentData,
                    createdAt: Date.now()
                });
                showMessage('Élève ajouté avec succès', 'success');
            }
            
            resetForm();
            await loadStudents();
            
        } catch (error) {
            console.error('Erreur de sauvegarde:', error);
            if (error.code === 'PERMISSION_DENIED') {
                showMessage('Session expirée. Veuillez vous reconnecter.', 'error');
                logout();
            } else {
                showMessage('Erreur de sauvegarde: ' + error.message, 'error');
            }
        }
    }

    async function editStudent(studentId) {
        const student = students.find(s => s.id === studentId);
        if (!student) return;
        
        document.getElementById('firstName').value = student.firstName || '';
        document.getElementById('lastName').value = student.lastName || '';
        document.getElementById('class').value = student.class || '';
        document.getElementById('forfaitDays').value = student.forfaitDays || 0;
        document.getElementById('locationDays').value = student.locationDays || 0;
        document.getElementById('keycard').value = student.keycard || 0;
        
        editIndex = studentId;
        document.getElementById('addBtn').innerHTML = '<i class="fas fa-save"></i> Mettre à jour';
        
        if (window.innerWidth < 768) {
            const formCard = document.querySelector('.form-card');
            if (formCard) formCard.scrollIntoView({ behavior: 'smooth' });
        }
    }

    async function deleteStudent(studentId) {
        if (!confirm('Supprimer cet élève ?')) return;
        
        try {
            const studentRef = database.ref(`students/${studentId}`);
            await studentRef.remove();
            showMessage('Élève supprimé avec succès', 'success');
            await loadStudents();
        } catch (error) {
            console.error('Erreur de suppression:', error);
            if (error.code === 'PERMISSION_DENIED') {
                showMessage('Session expirée. Veuillez vous reconnecter.', 'error');
                logout();
            } else {
                showMessage('Erreur de suppression', 'error');
            }
        }
    }

    function resetForm() {
        document.getElementById('firstName').value = '';
        document.getElementById('lastName').value = '';
        document.getElementById('class').value = '';
        document.getElementById('forfaitDays').value = '0';
        document.getElementById('locationDays').value = '0';
        document.getElementById('keycard').value = '0';
    }

    function downloadCSV() {
        if (students.length === 0) {
            showMessage('Aucun élève à exporter', 'error');
            return;
        }
        
        let csv = 'Nom;Prénom;Classe;Forfait_Jours;Forfait_Montant;Location_Jours;Location_Montant;KeyCard;KeyCard_Montant;Total;Economie;Total_Reel\n';
        
        students.forEach(student => {
            const forfaitPrice = (student.forfaitDays || 0) * 17.5;
            const locationPrice = (student.locationDays || 0) * 10;
            const keycardPrice = (student.keycard || 0) * 2;
            const total = forfaitPrice + locationPrice + keycardPrice;
            const savings = calculateSavings(total);
            const realTotal = total - savings;
            
            csv += `${student.lastName || ''};${student.firstName || ''};${student.class || ''};`;
            csv += `${student.forfaitDays || 0};${forfaitPrice.toFixed(2)};`;
            csv += `${student.locationDays || 0};${locationPrice.toFixed(2)};`;
            csv += `${student.keycard ? 'Oui' : 'Non'};${keycardPrice.toFixed(2)};`;
            csv += `${total.toFixed(2)};${savings.toFixed(2)};${realTotal.toFixed(2)}\n`;
        });
        
        const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `paiements_sortie_${new Date().toISOString().slice(0,10)}.csv`;
        link.click();
        
        showMessage('Export CSV généré', 'success');
    }

    function showMessage(message, type) {
        const notification = document.createElement('div');
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            left: 50%;
            transform: translateX(-50%);
            padding: 12px 24px;
            border-radius: 8px;
            color: white;
            font-weight: 500;
            z-index: 1000;
            animation: slideDown 0.3s ease;
            box-shadow: 0 4px 12px rgba(0,0,0,0.1);
        `;
        
        if (type === 'success') {
            notification.style.backgroundColor = 'var(--success)';
        } else if (type === 'error') {
            notification.style.backgroundColor = 'var(--danger)';
        } else {
            notification.style.backgroundColor = 'var(--primary)';
        }
        
        notification.textContent = message;
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.style.opacity = '0';
            notification.style.transform = 'translateX(-50%) translateY(-10px)';
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.parentNode.removeChild(notification);
                }
            }, 300);
        }, 3000);
    }

    // Initialisation
    document.addEventListener('DOMContentLoaded', async () => {
        // Ajouter l'animation CSS pour les notifications
        const style = document.createElement('style');
        style.textContent = `
            @keyframes slideDown {
                from {
                    opacity: 0;
                    transform: translateX(-50%) translateY(-20px);
                }
                to {
                    opacity: 1;
                    transform: translateX(-50%) translateY(0);
                }
            }
        `;
        document.head.appendChild(style);
        
        // Setup nettoyage avant fermeture
        setupBeforeUnload();
        
        // Focus sur le champ de code
        const authCodeInput = document.getElementById('authCode');
        if (authCodeInput) {
            authCodeInput.focus();
        }
        
        // Vérifier si une session existe déjà
        const hasValidSession = await checkExistingAuth();
        if (hasValidSession) {
            startSession();
        }
    });

    // Gestion des événements
    const authButton = document.getElementById('authButton');
    const logoutBtn = document.getElementById('logoutBtn');
    const addBtn = document.getElementById('addBtn');
    const downloadBtn = document.getElementById('downloadBtn');
    const searchInput = document.getElementById('searchInput');
    const classInput = document.getElementById('class');
    const authCodeInput = document.getElementById('authCode');

    if (authButton) {
        authButton.addEventListener('click', async () => {
            const code = authCodeInput ? authCodeInput.value : '';
            const token = await authenticateWithCode(code);
            if (token) {
                startSession();
            }
        });
    }

    if (authCodeInput) {
        authCodeInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                if (authButton) authButton.click();
            }
        });

        authCodeInput.addEventListener('input', (e) => {
            e.target.value = e.target.value.replace(/\D/g, '').slice(0, 4);
            e.target.classList.remove('error');
            const errorDiv = document.getElementById('authError');
            if (errorDiv) errorDiv.textContent = '';
        });
    }

    if (logoutBtn) {
        logoutBtn.addEventListener('click', logout);
    }

    if (addBtn) {
        addBtn.addEventListener('click', addOrUpdateStudent);
    }

    if (downloadBtn) {
        downloadBtn.addEventListener('click', downloadCSV);
    }
    
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            currentSearch = e.target.value;
            updateStudentList();
        });
    }

    if (classInput) {
        classInput.addEventListener('input', (e) => {
            e.target.value = e.target.value.toUpperCase().slice(0, 3);
        });
    }

    // Empêcher le formulaire de se soumettre
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && e.target.tagName !== 'BUTTON' && e.target.tagName !== 'TEXTAREA') {
            e.preventDefault();
        }
    });
