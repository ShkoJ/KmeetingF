import { 
    collection, addDoc, getDocs, query, where, onSnapshot, serverTimestamp, deleteDoc, doc 
} from "https://www.gstatic.com/firebasejs/12.4.0/firebase-firestore.js";

document.addEventListener('DOMContentLoaded', () => {
    const db = window.db;
    if (!db) return alert("Firebase not loaded. Check index.html.");

    const roomContent = document.getElementById('room-content');
    const modal = document.getElementById('booking-modal');
    const modalRoomName = document.getElementById('modal-room-name');
    const modalTimeSlot = document.getElementById('modal-time-slot');
    const bookingForm = document.getElementById('booking-form');
    const closeBtn = document.querySelector('.close-btn');
    const successMessage = document.getElementById('success-message');

    // Cancel Modal Elements
    const cancelModal = document.getElementById('cancel-modal');
    const closeCancelBtn = document.querySelector('.close-cancel-btn');
    const confirmCancelBtn = document.getElementById('confirm-cancel-btn');
    const cancelPasswordInput = document.getElementById('cancel-password');

    const ROOMS = [
        { id: 'downstairs', name: 'Downstairs Room', collection: 'bookings_downstairs', img: 'booking_downstairs.jpg' },
        { id: 'upstairs',   name: 'Upstairs Room',   collection: 'bookings_upstairs', img: 'booking_upstairs.jpg' }
    ];

    let cancelState = { id: null, collection: null, actualPassword: null };

    // Dynamic Room Section Generation
    ROOMS.forEach(room => {
        const section = document.createElement('div');
        section.className = 'room-section';
        section.id = `section-${room.id}`;
        section.dataset.room = room.id;

        section.innerHTML = `
            <div class="room-indicator">
                <img src="${room.img}" alt="${room.name}" class="room-hero-img">
                <h2>📍 You are viewing: <span>${room.name}</span></h2>
            </div>

            <div class="card booking-card">
                <h3>Select Date & Time</h3>
                <div class="form-group date-picker-group">
                    <div class="date-input-wrapper">
                        <input type="text" id="booking-date-${room.id}" class="form-control" placeholder="Select a date...">
                        <button class="icon-btn today-btn" data-room="${room.id}">Today</button>
                    </div>
                </div>
                <div class="time-selectors">
                    <div class="form-group half-width">
                        <label for="start-time-${room.id}">Start</label>
                        <select id="start-time-${room.id}" class="time-select"></select>
                    </div>
                    <div class="form-group half-width">
                        <label for="end-time-${room.id}">End</label>
                        <select id="end-time-${room.id}" class="time-select"></select>
                    </div>
                </div>
                <button class="primary-btn book-btn" data-room="${room.id}">Check Availability & Book</button>
            </div>

            <div class="schedule-section">
                <h3>Schedule for Selected Date</h3>
                <div id="booked-times-list-${room.id}" class="time-slots">
                    <p class="empty-state">Select a date to view bookings.</p>
                </div>
            </div>
        `;
        roomContent.appendChild(section);
    });

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
        successMessage.style.color = isError ? "var(--danger)" : "var(--success)";
        successMessage.classList.add('visible-message');
        setTimeout(() => successMessage.classList.remove('visible-message'), 3000);
    };

    const state = {};

    const initRoom = room => {
        const prefix = room.id;
        const dateInput = document.getElementById(`booking-date-${prefix}`);
        const startSel = document.getElementById(`start-time-${prefix}`);
        const endSel = document.getElementById(`end-time-${prefix}`);
        const checkBtn = document.querySelector(`.book-btn[data-room="${prefix}"]`);
        const bookedList = document.getElementById(`booked-times-list-${prefix}`);
        const todayBtn = document.querySelector(`.today-btn[data-room="${prefix}"]`);

        state[prefix] = { selectedDate: '', datePickerInstance: null };

        const renderBookedTimes = bookings => {
            bookedList.innerHTML = '';
            if (!bookings.length) {
                bookedList.innerHTML = '<p class="empty-state success-text">No bookings for this date. All clear!</p>';
                return;
            }
            bookings.sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));
            bookings.forEach(b => {
                const div = document.createElement('div');
                div.className = 'booked-slot';
                
                const now = new Date().getHours() * 60 + new Date().getMinutes();
                const bs = timeToMinutes(b.startTime), be = timeToMinutes(b.endTime);
                let isPast = false;

                if (state[prefix].selectedDate === todayStr()) {
                    if (bs <= now && now < be) {
                        div.classList.add('ongoing');
                    } else if (be <= now) {
                        div.classList.add('done');
                        isPast = true;
                    } else {
                        div.classList.add('upcoming');
                    }
                } else if (state[prefix].selectedDate < todayStr()) {
                    div.classList.add('done');
                    isPast = true;
                } else {
                    div.classList.add('upcoming');
                }
                
                div.innerHTML = `
                    <div class="slot-info">
                        <strong class="slot-time">${b.startTime} - ${b.endTime}</strong>
                        <span class="slot-details">${b.name} <span class="bullet">•</span> ${b.project}</span>
                    </div>
                `;

                // Add Cancel Button if not in the past
                if (!isPast) {
                    const cancelBtn = document.createElement('button');
                    cancelBtn.className = 'delete-icon-btn';
                    cancelBtn.innerHTML = `
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"></path></svg>
                    `;
                    cancelBtn.onclick = () => {
                        cancelState = { id: b.id, collection: room.collection, actualPassword: b.password };
                        cancelPasswordInput.value = '';
                        cancelModal.style.display = 'flex';
                    };
                    div.appendChild(cancelBtn);
                }

                bookedList.appendChild(div);
            });
        };

        const populateTimeSelectors = bookedSlots => {
            startSel.innerHTML = ''; endSel.innerHTML = '';
            const now = new Date();
            const today = todayStr();
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
                
                const isPast = state[prefix].selectedDate === today && mins < curMin;
                
                if (isPast || isBooked) { 
                    opt.disabled = true; 
                    opt.classList.add('unavailable'); 
                }
                select.appendChild(opt);
            };

            for (let i = 0; i < 24 * 60 / interval; i++) {
                addOption(startSel, i * interval, true);
            }
            
            if (state[prefix].selectedDate === today) {
                const nowMins = Math.ceil(curMin / interval) * interval;
                if (nowMins < timeToMinutes('24:00')) {
                    const nowTime = `${pad(Math.floor(nowMins / 60))}:${pad(nowMins % 60)}`;
                    const opt = document.createElement('option');
                    opt.value = nowTime;
                    opt.textContent = `Start Now (${nowTime})`;
                    opt.classList.add('now-option');
                    
                    const nextTime = `${pad(Math.floor((nowMins + interval) / 60))}:${pad((nowMins + interval) % 60)}`;
                    if (checkOverlap(bookedSlots, nowTime, nextTime)) {
                        opt.disabled = true;
                        opt.classList.add('unavailable');
                    }
                    startSel.prepend(opt); 
                }
            }

            const updateEnd = () => {
                endSel.innerHTML = '';
                const s = startSel.value;
                if (!s || startSel.selectedOptions[0].disabled) {
                    endSel.innerHTML = '<option value="">--</option>';
                    return; 
                }
                const startMins = timeToMinutes(s); 
                for (let i = Math.ceil(startMins / interval) + 1; i <= 24 * 60 / interval; i++) {
                    const mins = i * interval;
                    const time = `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`;
                    const opt = document.createElement('option');
                    opt.value = time; opt.textContent = time;
                    
                    if (checkOverlap(bookedSlots, s, time)) { 
                        opt.disabled = true; 
                        opt.classList.add('unavailable'); 
                    }
                    endSel.appendChild(opt);
                }
                endSel.value = endSel.querySelector('option:not(:disabled)') ? endSel.querySelector('option:not(:disabled)').value : '';
            };
            
            startSel.removeEventListener('change', updateEnd); 
            startSel.addEventListener('change', updateEnd);
            updateEnd();
        };

        const fetchBookings = date => {
            if (!date) {
                bookedList.innerHTML = '<p class="empty-state">Select a date to view bookings.</p>';
                populateTimeSelectors([]);
                return;
            }
            const q = query(collection(db, room.collection), where('date', '==', date));
            onSnapshot(q, snap => {
                const bookings = [];
                snap.forEach(doc => bookings.push({ ...doc.data(), id: doc.id }));
                renderBookedTimes(bookings);
                populateTimeSelectors(bookings); 
            });
        };

        const dp = flatpickr(dateInput, {
            minDate: "today",
            dateFormat: "Y-m-d",
            disableMobile: "true", // Forces modern web UI instead of native ugly scrollers
            onChange: (selectedDates, dateStr) => {
                state[prefix].selectedDate = dateStr; 
                fetchBookings(dateStr);
            }
        });
        state[prefix].datePickerInstance = dp;
        dp.setDate('today', true);

        todayBtn.addEventListener('click', () => dp.setDate('today', true));

        checkBtn.addEventListener('click', async () => {
            const start = startSel.value, end = endSel.value;
            const selectedDate = state[prefix].selectedDate; 

            if (!selectedDate) return showMessage('Please select a date.', true);
            if (startSel.selectedOptions[0].disabled || endSel.selectedOptions.length === 0 || endSel.selectedOptions[0].disabled) {
                 return showMessage('Slot unavailable. Choose another.', true);
            }
            if (!start || !end) return showMessage('Select start and end time.', true);
            if (timeToMinutes(end) <= timeToMinutes(start)) return showMessage('End time must be after start.', true);

            const roomData = ROOMS.find(r => r.id === prefix);
            const col = collection(db, roomData.collection);
            
            try {
                const snap = await getDocs(query(col, where('date', '==', selectedDate)));
                if (checkOverlap(snap.docs.map(d => d.data()), start, end)) {
                    fetchBookings(selectedDate); 
                    return showMessage('Slot just taken. Choose another.', true);
                }

                modalRoomName.textContent = `📍 ${room.name}`;
                modalTimeSlot.textContent = `${selectedDate} | ${start} to ${end}`;
                bookingForm.dataset.startTime = start;
                bookingForm.dataset.endTime = end;
                bookingForm.dataset.room = prefix;
                modal.style.display = 'flex';
                
            } catch (err) {
                console.error(err);
                showMessage('Network error. Try again.', true);
            }
        });
    };

    ROOMS.forEach(initRoom);

    // Tab switching (Segmented Control)
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            document.querySelectorAll('.room-section').forEach(s => s.classList.remove('active'));
            const roomSection = document.getElementById(`section-${btn.dataset.room}`);
            if (roomSection) roomSection.classList.add('active');
        });
    });
    
    document.querySelector('.tab-btn').click();

    // BOOKING SUBMISSION
    bookingForm.addEventListener('submit', async e => {
        e.preventDefault();
        const roomId = bookingForm.dataset.room;
        const room = ROOMS.find(r => r.id === roomId);
        const col = collection(db, room.collection);

        const name = document.getElementById('name').value.trim();
        const project = document.getElementById('project').value.trim();
        const password = document.getElementById('password').value;
        const startTime = bookingForm.dataset.startTime;
        const endTime = bookingForm.dataset.endTime;
        const bookingDate = state[roomId].selectedDate; 

        try {
            const snap = await getDocs(query(col, where('date', '==', bookingDate)));
            if (checkOverlap(snap.docs.map(d => d.data()), startTime, endTime)) {
                modal.style.display = 'none';
                return showMessage('Slot taken by someone else.', true);
            }

            await addDoc(col, {
                name, project, password, 
                startTime, endTime, date: bookingDate,
                timestamp: serverTimestamp()
            });

            modal.style.display = 'none';
            bookingForm.reset();
            showMessage('Booking Confirmed! ✅');

        } catch (err) {
            console.error(err);
            showMessage('Failed to book.', true);
        }
    });

    // CANCELLATION SUBMISSION
    confirmCancelBtn.addEventListener('click', async () => {
        const inputPass = cancelPasswordInput.value;
        if (!inputPass) return showMessage('Enter password to cancel', true);

        if (inputPass === cancelState.actualPassword) {
            try {
                await deleteDoc(doc(db, cancelState.collection, cancelState.id));
                cancelModal.style.display = 'none';
                showMessage('Booking Cancelled 🗑️');
            } catch (err) {
                console.error(err);
                showMessage('Error deleting booking', true);
            }
        } else {
            showMessage('Incorrect Password!', true);
        }
    });

    // Modal Close logic
    closeBtn.onclick = () => modal.style.display = 'none';
    closeCancelBtn.onclick = () => cancelModal.style.display = 'none';
    window.onclick = e => { 
        if (e.target === modal) modal.style.display = 'none'; 
        if (e.target === cancelModal) cancelModal.style.display = 'none'; 
    };
});
