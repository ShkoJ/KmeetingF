import { 
    collection, addDoc, getDocs, query, where, onSnapshot, serverTimestamp, deleteDoc, doc 
} from "https://www.gstatic.com/firebasejs/12.4.0/firebase-firestore.js";

document.addEventListener('DOMContentLoaded', () => {
    const db = window.db;
    if (!db) return alert("Firebase not loaded. Check index.html.");

    // Elements
    const dateInput = document.getElementById('booking-date');
    const startSel = document.getElementById('start-time');
    const endSel = document.getElementById('end-time');
    const checkBtn = document.getElementById('book-btn');
    const todayBtn = document.getElementById('today-btn');
    const bookedList = document.getElementById('booked-times-list');
    
    // Modals
    const modal = document.getElementById('booking-modal');
    const modalTimeSlot = document.getElementById('modal-time-slot');
    const bookingForm = document.getElementById('booking-form');
    const successMessage = document.getElementById('success-message');
    const cancelModal = document.getElementById('cancel-modal');
    const cancelPasswordInput = document.getElementById('cancel-password');
    const confirmCancelBtn = document.getElementById('confirm-cancel-btn');

    // State & Config
    const ROOM_COLLECTION = 'bookings_downstairs';
    let state = { selectedDate: '', datePickerInstance: null };
    let cancelState = { id: null, actualPassword: null };

    // Helpers
    const pad = n => String(n).padStart(2, '0');
    const timeToMinutes = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
    const todayStr = () => {
        const n = new Date();
        return `${n.getFullYear()}-${pad(n.getMonth() + 1)}-${pad(n.getDate())}`;
    };
    const checkOverlap = (bookings, s, e) => {
        const start = timeToMinutes(s), end = timeToMinutes(e);
        return bookings.some(b => timeToMinutes(b.startTime) < end && timeToMinutes(b.endTime) > start);
    };
    const showMessage = (msg, isError = false) => {
        successMessage.textContent = msg;
        successMessage.style.color = isError ? "#e74c3c" : "#27ae60";
        successMessage.classList.add('visible-message');
        setTimeout(() => successMessage.classList.remove('visible-message'), 3000);
    };

    const renderBookedTimes = bookings => {
        bookedList.innerHTML = '';
        if (!bookings.length) {
            bookedList.innerHTML = '<p class="empty-state">No bookings for this date.</p>';
            return;
        }
        bookings.sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));
        
        bookings.forEach(b => {
            const div = document.createElement('div');
            div.className = 'booked-slot';
            
            const now = new Date().getHours() * 60 + new Date().getMinutes();
            const bs = timeToMinutes(b.startTime), be = timeToMinutes(b.endTime);
            let isPast = false;
            let statusHTML = '';

            // Status Logic
            if (state.selectedDate === todayStr()) {
                if (bs <= now && now < be) {
                    div.classList.add('ongoing');
                    statusHTML = '<span class="status-label status-ongoing">Ongoing</span>';
                } else if (be <= now) {
                    div.classList.add('done');
                    statusHTML = '<span class="status-label status-done">Done</span>';
                    isPast = true;
                } else {
                    statusHTML = '<span class="status-label status-upcoming">Upcoming</span>';
                }
            } else if (state.selectedDate < todayStr()) {
                div.classList.add('done');
                statusHTML = '<span class="status-label status-done">Done</span>';
                isPast = true;
            } else {
                statusHTML = '<span class="status-label status-upcoming">Upcoming</span>';
            }
            
            const infoDiv = document.createElement('div');
            infoDiv.className = 'slot-info';
            infoDiv.innerHTML = `
                <strong class="slot-time">${b.startTime} - ${b.endTime}</strong>
                <span class="slot-details">${b.name} - ${b.project}</span>
            `;

            const controlDiv = document.createElement('div');
            controlDiv.className = 'slot-controls';
            controlDiv.innerHTML = statusHTML;

            // Add Cancel Button
            if (!isPast) {
                const cancelBtn = document.createElement('button');
                cancelBtn.className = 'delete-icon-btn';
                cancelBtn.innerHTML = `✕`; // Simple X character instead of emoji
                cancelBtn.onclick = () => {
                    cancelState = { id: b.id, actualPassword: b.password };
                    cancelPasswordInput.value = '';
                    cancelModal.style.display = 'flex';
                };
                controlDiv.appendChild(cancelBtn);
            }

            div.appendChild(infoDiv);
            div.appendChild(controlDiv);
            bookedList.appendChild(div);
        });
    };

    const populateTimeSelectors = bookedSlots => {
        startSel.innerHTML = ''; endSel.innerHTML = '';
        const now = new Date();
        const curMin = now.getHours() * 60 + now.getMinutes();
        const interval = 30; 

        const addOption = (select, mins, isStart) => {
            const time = `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`;
            const opt = document.createElement('option');
            opt.value = time; opt.textContent = time;
            
            let isBooked = false;
            if (isStart) {
                const nextTime = `${pad(Math.floor((mins + interval) / 60))}:${pad((mins + interval) % 60)}`;
                isBooked = checkOverlap(bookedSlots, time, nextTime);
            }
            
            const isPast = state.selectedDate === todayStr() && mins < curMin;
            if (isPast || isBooked) { opt.disabled = true; opt.classList.add('unavailable'); }
            select.appendChild(opt);
        };

        for (let i = 0; i < 24 * 60 / interval; i++) {
            addOption(startSel, i * interval, true);
        }

        const updateEnd = () => {
            endSel.innerHTML = '';
            const s = startSel.value;
            if (!s || startSel.selectedOptions[0]?.disabled) return;
            
            const startMins = timeToMinutes(s); 
            for (let i = Math.ceil(startMins / interval) + 1; i <= 24 * 60 / interval; i++) {
                const time = `${pad(Math.floor((i * interval) / 60))}:${pad((i * interval) % 60)}`;
                const opt = document.createElement('option');
                opt.value = time; opt.textContent = time;
                if (checkOverlap(bookedSlots, s, time)) { opt.disabled = true; opt.classList.add('unavailable'); }
                endSel.appendChild(opt);
            }
            endSel.value = endSel.querySelector('option:not(:disabled)')?.value || '';
        };
        
        startSel.removeEventListener('change', updateEnd); 
        startSel.addEventListener('change', updateEnd);
        updateEnd();
    };

    const fetchBookings = date => {
        if (!date) return;
        const q = query(collection(db, ROOM_COLLECTION), where('date', '==', date));
        onSnapshot(q, snap => {
            const bookings = snap.docs.map(doc => ({ ...doc.data(), id: doc.id }));
            renderBookedTimes(bookings);
            populateTimeSelectors(bookings); 
        });
    };

    // Initialize Datepicker
    state.datePickerInstance = flatpickr(dateInput, {
        minDate: "today",
        dateFormat: "Y-m-d",
        disableMobile: "true",
        onChange: (selectedDates, dateStr) => {
            state.selectedDate = dateStr; 
            fetchBookings(dateStr);
        }
    });
    
    state.datePickerInstance.setDate('today', true);
    todayBtn.addEventListener('click', () => state.datePickerInstance.setDate('today', true));

    // Check Availability & Open Modal
    checkBtn.addEventListener('click', async () => {
        const start = startSel.value, end = endSel.value;
        const selectedDate = state.selectedDate; 

        if (!selectedDate) return showMessage('Please select a date.', true);
        if (startSel.selectedOptions[0]?.disabled || endSel.selectedOptions.length === 0 || endSel.selectedOptions[0]?.disabled) {
             return showMessage('Slot unavailable. Choose another.', true);
        }
        if (!start || !end) return showMessage('Select start and end time.', true);
        if (timeToMinutes(end) <= timeToMinutes(start)) return showMessage('End time must be after start.', true);

        const col = collection(db, ROOM_COLLECTION);
        try {
            const snap = await getDocs(query(col, where('date', '==', selectedDate)));
            if (checkOverlap(snap.docs.map(d => d.data()), start, end)) {
                fetchBookings(selectedDate); 
                return showMessage('Slot just taken. Choose another.', true);
            }

            modalTimeSlot.textContent = `Time: ${start} - ${end} on ${selectedDate}`;
            bookingForm.dataset.startTime = start;
            bookingForm.dataset.endTime = end;
            modal.style.display = 'flex';
        } catch (err) {
            console.error(err);
            showMessage('Network error. Try again.', true);
        }
    });

    // Submit Booking
    bookingForm.addEventListener('submit', async e => {
        e.preventDefault();
        const col = collection(db, ROOM_COLLECTION);
        const name = document.getElementById('name').value.trim();
        const project = document.getElementById('project').value.trim();
        const password = document.getElementById('password').value;
        const startTime = bookingForm.dataset.startTime;
        const endTime = bookingForm.dataset.endTime;

        try {
            const snap = await getDocs(query(col, where('date', '==', state.selectedDate)));
            if (checkOverlap(snap.docs.map(d => d.data()), startTime, endTime)) {
                modal.style.display = 'none';
                return showMessage('Slot taken by someone else.', true);
            }

            await addDoc(col, {
                name, project, password, 
                startTime, endTime, date: state.selectedDate,
                timestamp: serverTimestamp()
            });

            modal.style.display = 'none';
            bookingForm.reset();
            showMessage('Booking Confirmed!');
        } catch (err) {
            console.error(err);
            showMessage('Failed to book.', true);
        }
    });

    // Cancel Booking
    confirmCancelBtn.addEventListener('click', async () => {
        const inputPass = cancelPasswordInput.value;
        if (!inputPass) return showMessage('Enter password to cancel', true);

        if (inputPass === cancelState.actualPassword) {
            try {
                await deleteDoc(doc(db, ROOM_COLLECTION, cancelState.id));
                cancelModal.style.display = 'none';
                showMessage('Booking Cancelled');
            } catch (err) {
                console.error(err);
                showMessage('Error deleting booking', true);
            }
        } else {
            showMessage('Incorrect Password!', true);
        }
    });

    // Close Modals
    document.querySelectorAll('.close-btn').forEach(btn => {
        btn.onclick = () => { modal.style.display = 'none'; cancelModal.style.display = 'none'; };
    });
    window.onclick = e => { 
        if (e.target === modal) modal.style.display = 'none'; 
        if (e.target === cancelModal) cancelModal.style.display = 'none'; 
    };
});
