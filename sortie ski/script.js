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

    let database = null;
    let authToken = null;
    let sessionTimer = null;
    let students = [];
    let editIndex = null;
    let currentSearch = '';

    // Initialiser Firebase une seule fois
    function initializeFirebase() {
        try {
            return firebase.initializeApp(firebaseConfig);
        } catch (error) {
            return firebase.app();
        }
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

    // Authentification SIMPLIFIÉE - sans vérification de temps dans les règles
    async function authenticateWithCode(code) {
        const authButton = document.getElementById('authButton');
        const errorDiv = document.getElementById('authError');
        
        if (code.length !== 4 || !/^\d{4}$/.test(code)) {
            showAuthError('Le code doit contenir exactement 4 chiffres');
            return null;
        }
        
        try {
            authButton.classList.add('loading');
            authButton.disabled = true;
            authButton.innerHTML = '<i class="fas fa-spinner"></i> Vérification...';
            
            // Initialiser Firebase
            const app = initializeFirebase();
            database = app.database();
            
            // 1. Lire la clé publique
            const accessSnapshot = await database.ref('access_control').once('value');
            
            if (!accessSnapshot.exists()) {
                throw new Error('Configuration manquante dans la base de données');
            }
            
            const publicKey = accessSnapshot.val().public_key;
            const codeHash = await sha256(code);
            
            if (codeHash !== publicKey) {
                throw new Error('Code incorrect');
            }
            
            // 2. Générer un challenge
            const challengeId = generateId();
            const challenge = generateId();
            const timestamp = Date.now();
            
            // 3. Sauvegarder le challenge (juste pour la validation initiale)
            await database.ref(`challenges/${challengeId}`).set({
                challenge: challenge,
                timestamp: timestamp
            });
            
            // 4. Calculer et sauvegarder la réponse
            const response = await sha256(code + challenge);
            const responseHash = await sha256(response);
            
            await database.ref(`valid_responses/${responseHash}`).set({
                challengeId: challengeId,
                response: response,
                timestamp: timestamp,
                // Ajouter un champ "active" pour éviter les vérifications de temps
                active: true,
                sessionStart: timestamp
            });
            
            // 5. Stocker le token localement POUR 30 MINUTES
            authToken = responseHash;
            const sessionStart = Date.now();
            localStorage.setItem('authToken', authToken);
            localStorage.setItem('sessionStart', sessionStart.toString());
            
            return authToken;
            
        } catch (error) {
            console.error('Erreur d\'authentification:', error);
            
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

    // Vérifier l'authentification au chargement - VERSION CORRIGÉE
    async function checkExistingAuth() {
        const savedToken = localStorage.getItem('authToken');
        const savedSessionStart = localStorage.getItem('sessionStart');
        
        if (!savedToken || !savedSessionStart) {
            return false;
        }
        
        // Vérifier si la session est encore valide (30 minutes)
        const sessionAge = Date.now() - parseInt(savedSessionStart);
        if (sessionAge > 30 * 60 * 1000) {
            // Session expirée côté client
            localStorage.removeItem('authToken');
            localStorage.removeItem('sessionStart');
            return false;
        }
        
        try {
            // Initialiser Firebase
            const app = initializeFirebase();
            database = app.database();
            authToken = savedToken;
            
            // Tester la connexion - sans vérification de temps dans Firebase
            await database.ref('students').limitToFirst(1).once('value');
            
            return true;
            
        } catch (error) {
            console.error('Erreur de vérification de session:', error);
            
            // Si erreur PERMISSION_DENIED, essayer de recréer le token
            if (error.code === 'PERMISSION_DENIED') {
                // La réponse dans Firebase a peut-être expiré
                // On considère la session comme invalide
                localStorage.removeItem('authToken');
                localStorage.removeItem('sessionStart');
            }
            
            return false;
        }
    }

    // Démarrer la session
    function startSession() {
        document.getElementById('authOverlay').style.display = 'none';
        document.getElementById('appContainer').style.display = 'block';
        document.getElementById('logoutBtn').style.display = 'flex';
        document.getElementById('sessionTimer').style.display = 'block';
        
        loadStudents();
        startSessionTimer();
        document.getElementById('searchInput').focus();
    }

    // Gérer le timer de session - VERSION CORRIGÉE
    function startSessionTimer() {
        const savedSessionStart = parseInt(localStorage.getItem('sessionStart'));
        if (!savedSessionStart) return;
        
        clearInterval(sessionTimer);
        
        function updateTimer() {
            const now = Date.now();
            const elapsed = now - savedSessionStart;
            const remaining = 30 * 60 * 1000 - elapsed;
            
            if (remaining <= 0) {
                // Session expirée - déconnecter
                logout();
                return;
            }
            
            const minutes = Math.floor(remaining / 60000);
            const seconds = Math.floor((remaining % 60000) / 1000);
            document.getElementById('timerValue').textContent = 
                `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        }
        
        // Mettre à jour immédiatement puis toutes les secondes
        updateTimer();
        sessionTimer = setInterval(updateTimer, 1000);
    }

    // Déconnexion SIMPLIFIÉE
    function logout() {
        clearInterval(sessionTimer);
        
        // NE PAS nettoyer les données Firebase (pour éviter les problèmes)
        
        // Nettoyer le localStorage seulement
        localStorage.removeItem('authToken');
        localStorage.removeItem('sessionStart');
        
        // Réinitialiser les variables
        database = null;
        authToken = null;
        students = [];
        
        // Réafficher l'écran d'authentification
        document.getElementById('authOverlay').style.display = 'flex';
        document.getElementById('appContainer').style.display = 'none';
        document.getElementById('logoutBtn').style.display = 'none';
        document.getElementById('sessionTimer').style.display = 'none';
        document.getElementById('authCode').value = '';
        document.getElementById('authCode').focus();
        
        // Réinitialiser l'interface
        document.getElementById('studentsBody').innerHTML = '';
        document.getElementById('emptyState').style.display = 'block';
        updateStats();
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
        loadingElement.style.display = 'block';
        
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
            loadingElement.style.display = 'none';
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
            tbody.innerHTML = '';
            emptyState.style.display = 'block';
            updateStats();
            return;
        }
        
        emptyState.style.display = 'none';
        tbody.innerHTML = '';
        
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
            tbody.appendChild(row);
        });
        
        updateStats(totalAmount, totalSavings);
    }

    function updateStats(totalAmount = 0, totalSavings = 0) {
        document.getElementById('totalStudents').textContent = students.length;
        document.getElementById('totalAmount').textContent = formatCurrency(totalAmount);
        document.getElementById('totalSavings').textContent = formatCurrency(totalSavings);
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
            document.querySelector('.form-card').scrollIntoView({ behavior: 'smooth' });
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

    // Gestion des événements
    document.getElementById('authButton').addEventListener('click', async () => {
        const code = document.getElementById('authCode').value;
        const token = await authenticateWithCode(code);
        if (token) {
            startSession();
        }
    });

    document.getElementById('authCode').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            document.getElementById('authButton').click();
        }
    });

    document.getElementById('authCode').addEventListener('input', (e) => {
        e.target.value = e.target.value.replace(/\D/g, '').slice(0, 4);
        e.target.classList.remove('error');
        document.getElementById('authError').textContent = '';
    });

    document.getElementById('logoutBtn').addEventListener('click', logout);

    document.getElementById('addBtn').addEventListener('click', addOrUpdateStudent);
    document.getElementById('downloadBtn').addEventListener('click', downloadCSV);
    
    document.getElementById('searchInput').addEventListener('input', (e) => {
        currentSearch = e.target.value;
        updateStudentList();
    });

    document.getElementById('class').addEventListener('input', (e) => {
        e.target.value = e.target.value.toUpperCase().slice(0, 3);
    });

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
        
        // Focus sur le champ de code
        document.getElementById('authCode').focus();
        
        // Vérifier si une session existe déjà
        const hasValidSession = await checkExistingAuth();
        if (hasValidSession) {
            startSession();
        }
    });

    // Empêcher le formulaire de se soumettre
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && e.target.tagName !== 'BUTTON' && e.target.tagName !== 'TEXTAREA') {
            e.preventDefault();
        }
    });
