<script src="https://www.gstatic.com/firebasejs/9.22.0/firebase-app-compat.js"></script>
<script src="https://www.gstatic.com/firebasejs/9.22.0/firebase-database-compat.js"></script>

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

    let firebaseApp = null;
    let database = null;
    let currentAuthToken = null;
    let sessionTimer = null;
    let students = [];
    let editIndex = null;
    let currentSearch = '';

    // Fonctions utilitaires
    async function sha256(message) {
        const msgBuffer = new TextEncoder().encode(message);
        const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }

    function generateId() {
        return Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }

    function formatCurrency(amount) {
        return amount.toFixed(2).replace('.', ',') + '€';
    }

    function calculateSavings(total) {
        return savingsMap[total] || 0;
    }

    // Système d'authentification SIMPLIFIÉ
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
            
            // 1. Initialiser Firebase
            if (firebaseApp) {
                try { firebaseApp.delete(); } catch(e) {}
            }
            firebaseApp = firebase.initializeApp(firebaseConfig, 'main_app_' + Date.now());
            database = firebaseApp.database();
            
            // 2. Vérifier le code avec une requête simple
            const accessRef = database.ref('access_control');
            const accessSnapshot = await accessRef.once('value');
            
            if (!accessSnapshot.exists()) {
                throw new Error('Configuration manquante');
            }
            
            const publicKey = accessSnapshot.val().public_key;
            const codeHash = await sha256(code);
            
            if (codeHash !== publicKey) {
                throw new Error('Code incorrect');
            }
            
            // 3. Créer un token simple (timestamp + code hash)
            const timestamp = Date.now();
            const sessionToken = await sha256(codeHash + timestamp.toString());
            
            // 4. Sauvegarder le token dans Firebase (sans vérification complexe)
            const tokenRef = database.ref('session_tokens/' + sessionToken);
            await tokenRef.set({
                created: timestamp,
                expires: timestamp + (30 * 60 * 1000), // 30 minutes
                valid: true
            });
            
            // 5. Stocker localement
            currentAuthToken = sessionToken;
            localStorage.setItem('authToken', sessionToken);
            localStorage.setItem('authTimestamp', timestamp.toString());
            
            return sessionToken;
            
        } catch (error) {
            console.error('Erreur d\'authentification:', error);
            showAuthError(error.message.includes('incorrect') ? 'Code incorrect' : 'Erreur de connexion');
            return null;
        } finally {
            authButton.classList.remove('loading');
            authButton.disabled = false;
            authButton.innerHTML = '<i class="fas fa-lock"></i> Accéder';
        }
    }

    // Vérifier session existante
    async function checkExistingAuth() {
        const savedToken = localStorage.getItem('authToken');
        const savedTimestamp = localStorage.getItem('authTimestamp');
        
        if (!savedToken || !savedTimestamp) {
            return false;
        }
        
        const sessionAge = Date.now() - parseInt(savedTimestamp);
        if (sessionAge > 30 * 60 * 1000) {
            // Session expirée
            logout();
            return false;
        }
        
        try {
            // Initialiser Firebase
            if (firebaseApp) {
                try { firebaseApp.delete(); } catch(e) {}
            }
            firebaseApp = firebase.initializeApp(firebaseConfig, 'existing_app_' + Date.now());
            database = firebaseApp.database();
            currentAuthToken = savedToken;
            
            // Tester la connexion
            await database.ref('students').limitToFirst(1).once('value');
            
            return true;
        } catch (error) {
            console.error('Session invalide:', error);
            return false;
        }
    }

    // Nettoyage à la déconnexion
    async function cleanupOnLogout() {
        if (!database || !currentAuthToken) return;
        
        try {
            // Supprimer le token de session
            await database.ref('session_tokens/' + currentAuthToken).remove();
        } catch (error) {
            console.log('Note: Token déjà supprimé ou non trouvé');
        }
    }

    // Déconnexion
    async function logout() {
        clearInterval(sessionTimer);
        
        // Nettoyer Firebase
        await cleanupOnLogout();
        
        // Nettoyer localStorage
        localStorage.removeItem('authToken');
        localStorage.removeItem('authTimestamp');
        
        // Nettoyer Firebase App
        if (firebaseApp) {
            try {
                firebaseApp.delete();
            } catch (e) {
                console.log('Erreur lors du nettoyage Firebase:', e);
            }
            firebaseApp = null;
        }
        
        // Réinitialiser
        database = null;
        currentAuthToken = null;
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

    // Démarrer la session
    function startSession() {
        document.getElementById('authOverlay').style.display = 'none';
        document.getElementById('appContainer').style.display = 'block';
        document.getElementById('logoutBtn').style.display = 'flex';
        document.getElementById('sessionTimer').style.display = 'block';
        
        loadStudents();
        startSessionTimer();
    }

    // Timer de session
    function startSessionTimer() {
        const savedTimestamp = parseInt(localStorage.getItem('authTimestamp'));
        if (!savedTimestamp) return;
        
        clearInterval(sessionTimer);
        
        function updateTimer() {
            const now = Date.now();
            const elapsed = now - savedTimestamp;
            const remaining = 30 * 60 * 1000 - elapsed;
            
            if (remaining <= 0) {
                logout();
                return;
            }
            
            const minutes = Math.floor(remaining / 60000);
            const seconds = Math.floor((remaining % 60000) / 1000);
            document.getElementById('timerValue').textContent = 
                `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        }
        
        updateTimer();
        sessionTimer = setInterval(updateTimer, 1000);
    }

    // Fonctions de gestion des données
    async function loadStudents() {
        if (!database) return;
        
        const loadingElement = document.getElementById('loadingData');
        loadingElement.style.display = 'block';
        
        try {
            const snapshot = await database.ref('students').once('value');
            
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
            }
        } finally {
            loadingElement.style.display = 'none';
        }
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
                await database.ref(`students/${editIndex}`).update(studentData);
                showMessage('Élève mis à jour', 'success');
                editIndex = null;
                document.getElementById('addBtn').innerHTML = '<i class="fas fa-plus"></i> Ajouter élève';
            } else {
                const newRef = database.ref('students').push();
                await newRef.set({
                    ...studentData,
                    createdAt: Date.now()
                });
                showMessage('Élève ajouté', 'success');
            }
            
            resetForm();
            await loadStudents();
            
        } catch (error) {
            console.error('Erreur de sauvegarde:', error);
            if (error.code === 'PERMISSION_DENIED') {
                showMessage('Session expirée', 'error');
                logout();
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
    }

    async function deleteStudent(studentId) {
        if (!confirm('Supprimer cet élève ?')) return;
        
        try {
            await database.ref(`students/${studentId}`).remove();
            showMessage('Élève supprimé', 'success');
            await loadStudents();
        } catch (error) {
            console.error('Erreur de suppression:', error);
            if (error.code === 'PERMISSION_DENIED') {
                showMessage('Session expirée', 'error');
                logout();
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

    function updateStudentList() {
        const tbody = document.getElementById('studentsBody');
        const emptyState = document.getElementById('emptyState');
        const filteredStudents = students.filter(student => {
            const searchTerm = currentSearch.toLowerCase();
            return (
                (student.lastName || '').toLowerCase().includes(searchTerm) ||
                (student.firstName || '').toLowerCase().includes(searchTerm) ||
                (student.class || '').toLowerCase().includes(searchTerm)
            );
        });
        
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

    // UI Helpers
    function showAuthError(message) {
        const errorDiv = document.getElementById('authError');
        const input = document.getElementById('authCode');
        
        errorDiv.textContent = message;
        input.classList.add('error');
        
        setTimeout(() => {
            errorDiv.textContent = '';
        }, 3000);
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
        
        notification.style.backgroundColor = type === 'success' ? 'var(--success)' : 
                                           type === 'error' ? 'var(--danger)' : 'var(--primary)';
        
        notification.textContent = message;
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.remove();
        }, 3000);
    }

    // Événements
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
        // Ajouter l'animation CSS
        const style = document.createElement('style');
        style.textContent = `
            @keyframes slideDown {
                from { opacity: 0; transform: translateX(-50%) translateY(-20px); }
                to { opacity: 1; transform: translateX(-50%) translateY(0); }
            }
        `;
        document.head.appendChild(style);
        
        document.getElementById('authCode').focus();
        
        const hasSession = await checkExistingAuth();
        if (hasSession) {
            startSession();
        }
    });
