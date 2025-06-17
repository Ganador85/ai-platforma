document.addEventListener('DOMContentLoaded', () => {
    // --- ELEMENTŲ INICIALIZAVIMAS ---
    const form = document.getElementById("chat-form");
    const input = document.getElementById("user-input");
    const messagesContainer = document.getElementById("chat-box");
    const newChatBtn = document.getElementById("new-chat-btn");
    const historyList = document.getElementById("history-list");
    const uploadBtn = document.getElementById("upload-btn");
    const fileInput = document.getElementById("file-input");
    const searchForm = document.getElementById("search-form");
    const searchInput = document.getElementById("search-input");
    const searchResultsContainer = document.getElementById("search-results-container");
    const chatContainer = document.getElementById('chat-container');
    const menuToggleBtn = document.getElementById('menu-toggle-btn');
    const overlay = document.getElementById('overlay');
    const logoutBtn = document.getElementById("logout-btn");
    const mainHeader = document.querySelector('.main-header');

    // --- BŪSENOS KINTAMIEJI ---
    let conversationId = null;
    let isLoading = false;
    let stagedFiles = [];
    let lastScrollTop = 0;

    // --- ĮVYKIŲ KLAUSYTOJAI ---
	if (logoutBtn) {
	    logoutBtn.addEventListener("click", async () => {
	        try {
	            const res = await fetch("/logout", { method: "POST", credentials: "include" });
	            if (res.ok) {
	                window.location.href = "/auth.html";
	            } else {
	                alert("Nepavyko atsijungti.");
	            }
	        } catch (err) {
	            console.error("Atsijungimo klaida:", err);
	        }
	    });
	}
    newChatBtn.addEventListener('click', startNewConversation);
    form.addEventListener("submit", handleFormSubmit);
    input.addEventListener("keydown", handleEnterKey);
    input.addEventListener('input', autoResizeTextarea);
    uploadBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', handleFileSelect);

    // PAKEITIMAS: Pridėtas klausytojas, kuris paspaudus ant įvesties laukelio prascrollina pokalbius į apačią.
    // Tai pagerina vartotojo patirtį atsidarius klaviatūrai.
    input.addEventListener('focus', () => {
        setTimeout(() => {
            messagesContainer.scrollTo({ top: messagesContainer.scrollHeight, behavior: 'smooth' });
        }, 300); // Mažas uždelsimas, kad vartotojo sąsaja spėtų prisitaikyti prie klaviatūros
    });

    if (searchForm) {
        searchForm.addEventListener('submit', handleSearchSubmit);
    }

    chatContainer.addEventListener('dragover', handleDragOver);
    chatContainer.addEventListener('dragleave', handleDragLeave);
    chatContainer.addEventListener('drop', handleDrop);

    if (menuToggleBtn) {
        menuToggleBtn.addEventListener('click', () => {
            document.body.classList.toggle('sidebar-visible');
        });
    }

    if (overlay) {
        overlay.addEventListener('click', () => {
            document.body.classList.remove('sidebar-visible');
        });
    }

    if (messagesContainer && mainHeader) {
        messagesContainer.addEventListener("scroll", () => {
            const scrollTop = messagesContainer.scrollTop;
            if (scrollTop > lastScrollTop && scrollTop > 50) {
                mainHeader.classList.add("header-hidden");
            } else if (scrollTop < lastScrollTop) {
                mainHeader.classList.remove("header-hidden");
            }
            lastScrollTop = scrollTop <= 0 ? 0 : scrollTop;
        });
    }

    // --- PRADINIS PALEIDIMAS ---
    initializeApp();

    // --- FUNKCIJŲ APRAŠYMAI ---
    async function initializeApp() {
        const conversations = await fetchAndRenderHistory();
        if (conversations && conversations.length > 0) {
            loadConversation(conversations[0].id);
        } else {
            startNewConversation();
        }
        input.focus();
    }

    async function handleSearchSubmit(e) {
        e.preventDefault();
        const query = searchInput.value.trim();
        if (!query || isLoading) return;
        isLoading = true;
        searchResultsContainer.innerHTML = `<p>Ieškoma...</p>`;
        showSearchResults();
        try {
            const res = await fetch('/search', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query })
            });
            if (!res.ok) throw new Error('Paieškos užklausa nepavyko');
            const { matches } = await res.json();
            displaySearchResults(matches);
        } catch (error) {
            console.error('Paieškos klaida:', error);
            searchResultsContainer.innerHTML = `<p class="error-message">⚠️ Įvyko klaida vykdant paiešką.</p>`;
        } finally {
            isLoading = false;
        }
    }

    function displaySearchResults(matches) {
        searchResultsContainer.innerHTML = '';
        const backButton = document.createElement('button');
        backButton.textContent = '‹ Grįžti į pokalbį';
        backButton.className = 'back-button';
        backButton.onclick = hideSearchResults;
        searchResultsContainer.appendChild(backButton);

        const resultsHeader = document.createElement('h3');
        resultsHeader.textContent = 'Paieškos rezultatai';
        searchResultsContainer.appendChild(resultsHeader);

        if (!matches || matches.length === 0) {
            const noResults = document.createElement('p');
            noResults.textContent = 'Pagal jūsų užklausą atitikmenų nerasta.';
            searchResultsContainer.appendChild(noResults);
            return;
        }

        matches.forEach(match => {
            const resultDiv = document.createElement('div');
            resultDiv.className = 'search-result-item clickable';
            resultDiv.dataset.conversationId = match.conversation_id;

            resultDiv.addEventListener('click', () => {
                const convId = resultDiv.dataset.conversationId;
                if (convId) {
                    loadConversation(convId);
                }
            });

            const roleSpan = document.createElement('span');
            roleSpan.className = `role-badge ${match.role}`;
            roleSpan.textContent = match.role === 'user' ? 'Vartotojas' : 'Asistentas';
            const dateSpan = document.createElement('span');
            dateSpan.className = 'timestamp';
            dateSpan.textContent = new Date(match.created_at).toLocaleString('lt-LT');
            const contentP = document.createElement('p');
            contentP.textContent = match.content;
            const headerDiv = document.createElement('div');
            headerDiv.className = 'result-header';
            headerDiv.appendChild(roleSpan);
            headerDiv.appendChild(dateSpan);
            resultDiv.appendChild(headerDiv);
            resultDiv.appendChild(contentP);
            searchResultsContainer.appendChild(resultDiv);
        });
    }

    function showSearchResults() {
        messagesContainer.style.display = 'none';
        document.getElementById('chat-form').style.display = 'none';
        searchResultsContainer.style.display = 'block';
    }

    function hideSearchResults() {
        searchResultsContainer.style.display = 'none';
        messagesContainer.style.display = 'flex';
        document.getElementById('chat-form').style.display = 'flex';
        searchInput.value = '';
    }

    function handleFileSelect(event) {
        const files = event.target.files;
        if (!files.length) return;
        addFilesToStaging(files);
    }

    function handleDragOver(e) {
        e.preventDefault();
        e.stopPropagation();
        chatContainer.classList.add('drag-over');
    }

    function handleDragLeave(e) {
        e.preventDefault();
        e.stopPropagation();
        chatContainer.classList.remove('drag-over');
    }

    function handleDrop(e) {
        e.preventDefault();
        e.stopPropagation();
        chatContainer.classList.remove('drag-over');
        const files = e.dataTransfer.files;
        if (files.length) {
            addFilesToStaging(files);
        }
    }

    function addFilesToStaging(files) {
        for (const file of files) {
            stagedFiles.push(file);
        }
        renderStagedFiles();
        fileInput.value = '';
    }

    function renderStagedFiles() {
        const container = document.getElementById('staged-files-container');
        container.innerHTML = '';
        if (stagedFiles.length > 0) {
            container.style.display = 'flex';
        } else {
            container.style.display = 'none';
        }
        stagedFiles.forEach((file, index) => {
            const fileDiv = document.createElement('div');
            fileDiv.className = 'staged-file-item';
            const nameSpan = document.createElement('span');
            nameSpan.className = 'staged-file-name';
            nameSpan.textContent = file.name;
            const removeBtn = document.createElement('button');
            removeBtn.className = 'remove-file-btn';
            removeBtn.innerHTML = '&times;';
            removeBtn.title = 'Pašalinti failą';
            removeBtn.type = 'button';
            removeBtn.onclick = () => {
                stagedFiles.splice(index, 1);
                renderStagedFiles();
            };
            fileDiv.appendChild(nameSpan);
            fileDiv.appendChild(removeBtn);
            container.appendChild(fileDiv);
        });
    }

    function startNewConversation() {
        if (isLoading) return;
        hideSearchResults();
        messagesContainer.innerHTML = '';
        conversationId = null;
        stagedFiles = [];
        renderStagedFiles();
        addMessage('ai', 'Sveiki! Aš esu jūsų asmeninis asistentas. Kuo galiu padėti?');
        input.focus();
        document.querySelectorAll('#history-list li').forEach(item => item.classList.remove('active'));
    }

    async function fetchAndRenderHistory() {
        try {
            const res = await fetch('/conversations');
            if (!res.ok) throw new Error('Nepavyko gauti pokalbių sąrašo');
            const conversations = await res.json();
            historyList.innerHTML = '';
            const ul = document.createElement('ul');
            conversations.forEach(conv => {
                const li = createHistoryListItem(conv);
                ul.appendChild(li);
            });
            historyList.appendChild(ul);
            return conversations;
        } catch (error) {
            console.error('Klaida kraunant istoriją:', error);
            return [];
        }
    }

    function createHistoryListItem(conv) {
        const li = document.createElement('li');
        li.dataset.id = conv.id;
        const titleSpan = document.createElement('span');
        titleSpan.className = 'history-item-title';
        titleSpan.textContent = conv.title || 'Pokalbis be pavadinimo';
        li.appendChild(titleSpan);
        li.appendChild(createActionButtons(li, titleSpan, conv));

        li.addEventListener('click', (e) => {
            if (e.target.closest('.history-item-actions')) return;
            hideSearchResults();
            loadConversation(conv.id);
            if (window.innerWidth <= 768) {
                document.body.classList.remove('sidebar-visible');
            }
        });
        return li;
    }

    function createActionButtons(li, titleSpan, conv) {
        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'history-item-actions';
        const editBtn = document.createElement('button');
        editBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>`;
        editBtn.title = 'Pervadinti';
        editBtn.onclick = (e) => { e.stopPropagation(); toggleEditMode(li, titleSpan, conv); };
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'delete-btn';
        deleteBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`;
        deleteBtn.title = 'Ištrinti';
        deleteBtn.onclick = async (e) => {
            e.stopPropagation();
            if (confirm(`Ar tikrai norite negrįžtamai ištrinti pokalbį "${titleSpan.textContent}"?`)) {
                try {
                    const res = await fetch(`/conversations/${conv.id}`, { method: 'DELETE' });
                    if (!res.ok) throw new Error('Serverio klaida trinant');
                    li.remove();
                    if (conversationId === conv.id) initializeApp();
                } catch (error) {
                    console.error("Nepavyko ištrinti pokalbio:", error);
                    alert("Klaida: nepavyko ištrinti pokalbio.");
                }
            }
        };
        actionsDiv.appendChild(editBtn);
        actionsDiv.appendChild(deleteBtn);
        return actionsDiv;
    }

    function toggleEditMode(li, titleSpan, conv) {
        const actionsDiv = li.querySelector('.history-item-actions');
        if (actionsDiv) actionsDiv.style.display = 'none';
        const currentTitle = titleSpan.textContent;
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'history-item-edit-input';
        input.value = currentTitle;
        li.replaceChild(input, titleSpan);
        input.focus();
        input.select();
        const saveChanges = async () => {
            const newTitle = input.value.trim();
            li.replaceChild(titleSpan, input);
            if(actionsDiv) actionsDiv.style.display = '';
            if (newTitle && newTitle !== currentTitle) {
                try {
                    const res = await fetch(`/conversations/${conv.id}`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ title: newTitle })
                    });
                    if (!res.ok) throw new Error('Serverio klaida');
                    titleSpan.textContent = newTitle;
                } catch (error) { console.error("Nepavyko pervadinti:", error); }
            }
        };
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); input.blur(); } else if (e.key === 'Escape') { input.blur(); }});
        input.addEventListener('blur', saveChanges);
    }

    async function loadConversation(id) {
        if (id === conversationId || isLoading) return;
        hideSearchResults();
        try {
            const res = await fetch(`/conversations/${id}`);
            if (!res.ok) throw new Error('Nepavyko gauti pokalbio žinučių');
            const messages = await res.json();
            messagesContainer.innerHTML = '';
            messages.forEach(msg => addMessage(msg.role, msg.content, false));
            conversationId = id;
            stagedFiles = [];
            renderStagedFiles();
            input.focus();
            document.querySelectorAll('#history-list li').forEach(item => item.classList.toggle('active', item.dataset.id === id));
        } catch (error) {
            console.error(`Klaida kraunant pokalbį ${id}:`, error);
            addMessage('ai', '⚠️ Nepavyko užkrauti pokalbio.');
        }
    }

    async function sendMessage() {
        if (isLoading) return;
        const userMessage = input.value.trim();
        if (!userMessage && stagedFiles.length === 0) return;

        const isNewConv = !conversationId;
        isLoading = true;

        if (userMessage) {
            addMessage("user", userMessage);
        }

        const formData = new FormData();
        formData.append('message', userMessage);
        if (conversationId) {
            formData.append('conversation_id', conversationId);
        }
        stagedFiles.forEach(file => {
            formData.append('documents', file);
        });

        input.value = "";
        autoResizeTextarea();
        stagedFiles = [];
        renderStagedFiles();

        const aiMessageDiv = addMessage("ai", "", false);
        const typingIndicator = createTypingIndicator();
        aiMessageDiv.appendChild(typingIndicator);
        messagesContainer.scrollTo({ top: messagesContainer.scrollHeight, behavior: 'smooth' });

        try {
            const res = await fetch("/ask", { method: "POST", body: formData });
            if (!res.ok) throw new Error(`Serverio klaida: ${res.status}`);
            typingIndicator.remove();

            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let fullReplyText = "";

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                const chunkText = decoder.decode(value);
                const lines = chunkText.split('\n').filter(line => line.trim() !== '');
                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const data = line.substring(6);
                        if (data === '[DONE]') {
                            aiMessageDiv.appendChild(createCopyButton(fullReplyText));
                            break;
                        }
                        const parsed = JSON.parse(data);
                        if (parsed.content) {
                            aiMessageDiv.innerText += parsed.content;
                            fullReplyText += parsed.content;
                        }
                        if (parsed.conversation_id && !conversationId) {
                            conversationId = parsed.conversation_id;
                        }
                        messagesContainer.scrollTo({ top: messagesContainer.scrollHeight, behavior: 'auto' });
                    }
                }
                if (chunkText.includes('[DONE]')) break;
            }
        } catch (err) {
            aiMessageDiv.remove();
            addMessage("ai", "⚠️ Klaida jungiantis prie serverio.");
            console.error(err);
        } finally {
            isLoading = false;
            if (isNewConv && conversationId) {
                await fetchAndRenderHistory();
                document.querySelectorAll('#history-list li').forEach(item => item.classList.toggle('active', item.dataset.id === conversationId));
            } else if (!isNewConv && conversationId) {
                const ul = historyList.querySelector('ul');
                const currentLi = document.querySelector(`#history-list li[data-id="${conversationId}"]`);
                if (ul && currentLi) {
                    ul.prepend(currentLi);
                }
            }
        }
    }

    function handleFormSubmit(e) { e.preventDefault(); sendMessage(); }
    function handleEnterKey(e) { if (e.key === "Enter" && !e.altKey && !e.shiftKey) { e.preventDefault(); sendMessage(); } }
    function autoResizeTextarea() { input.style.height = 'auto'; input.style.height = (input.scrollHeight) + 'px'; }

    function addMessage(role, content, withAnimation = true) {
        const msgDiv = document.createElement("div");
        msgDiv.className = `${role === 'user' ? 'user-message' : 'ai-message'}`;
        if(withAnimation) msgDiv.classList.add("message-enter");
        msgDiv.innerText = content;
        if (content.startsWith("⚠️")) msgDiv.classList.add("error-message");
        if (role === 'ai' && !content.startsWith("⚠️") && content) {
            msgDiv.appendChild(createCopyButton(content));
        }
        messagesContainer.appendChild(msgDiv);
        messagesContainer.scrollTo({ top: messagesContainer.scrollHeight, behavior: 'smooth' });
        return msgDiv;
    }

    function createCopyButton(contentToCopy) {
        const copyBtn = document.createElement('button');
        copyBtn.className = 'copy-btn';
        copyBtn.title = 'Kopijuoti tekstą';
        const copyIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;
        const checkIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
        copyBtn.innerHTML = copyIcon;
        copyBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            navigator.clipboard.writeText(contentToCopy).then(() => {
                copyBtn.innerHTML = checkIcon;
                setTimeout(() => { copyBtn.innerHTML = copyIcon; }, 1500);
            });
        });
        return copyBtn;
    }

    function createTypingIndicator() {
        const indicatorWrapper = document.createElement("div");
        indicatorWrapper.className = "indicator-container";
        indicatorWrapper.innerHTML = `<img src="images/thinking.gif" alt="AI mąsto..." />`;
        return indicatorWrapper;
    }
});
