import { 
    collection, addDoc, deleteDoc, doc, getDoc, getDocs, query, where, onSnapshot, serverTimestamp 
} from "https://www.gstatic.com/firebasejs/12.4.0/firebase-firestore.js";

document.addEventListener('DOMContentLoaded', () => {
    const db = window.db;
    if (!db) return alert("Firebase not loaded.");

    const roomContent = document.getElementById('room-content');
    const modal = document.getElementById('booking-modal');
    const modalRoomName = document.getElementById('modal-room-name');
    const modalTimeSlot = document.getElementById('modal-time-slot');
    const bookingForm = document.getElementById('booking-form');
    const closeBtn = document.querySelector('.close-btn');
    const successMessage = document.getElementById('success-message');

    const ROOMS = [
        { id: 'downstairs', name: 'Minara (منارە)', collection: 'bookings_downstairs' },
        { id: 'upstairs',   name: 'Qala (قەڵا)',     collection: 'bookings_upstairs' }
    ];

    ROOMS.forEach(room => {
        const section = document.createElement('div');
        section.className = 'room-section';
        section.id = `section-${room.id}`;
        section.dataset.room = room.id;

        section.innerHTML = `
            <div class="booking-options-section">
                <h2>Select Date & Time – ${room.name}</h2>
                <div class="form-group date-picker-group">
                    <label for="booking-date-${room.id}">Select Date:</label>
                    <div class="date-input-wrapper">
                        <input type="text" id="booking-date-${room.id}" class="form-control" placeholder="Select a date...">
                        <button class="today-btn" data-room="${room.id}">Today</button>
                    </div>
                </div>
                <div class="time-selectors">
                    <div class="form-group">
                        <label for="start-time-${room.id}">Start Time:</label>
                        <select id="start-time-${room.id}" class="time-select"></select>
                    </div>
                    <div class="form-group">
                        <label for="end-time-${room.id}">End Time:</label>
                        <select id="end-time-${room.id}" class="time-select"></select>
                    </div>
                </div>
                <button class="book-btn" data-room="${room.id}">Check Availability & Book</button>
            </div>

            <div class="booked-times-section">
                <h2>Booked Meetings – ${room.name}</h2>
                <div id="booked-times-list-${room.id}" class="time-slots">
                    <p>Select a date to view bookings.</p>
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

    // One state object per room
    const state = {};

    const initRoom = room => {
        const prefix = room.id;
        const dateInput = document.getElementById(`booking-date-${prefix}`);
        const startSel = document.getElementById(`start-time-${prefix}`);
        const endSel = document.getElementById(`end-time-${prefix}`);
        const checkBtn = document.querySelector(`.book-btn[data-room="${prefix}"]`);
        const bookedList = document.getElementById(`booked-times-list-${prefix}`);
        const todayBtn = document.querySelector(`.today-btn[data-room="${prefix}"]`);

        // Initialize state for this room
        state[prefix] = {
            selectedDate: '',
            datePickerInstance: null
        };

        // Flatpickr
        const dp = flatpickr(dateInput, {
            minDate: "today",
            dateFormat: "Y-m-d",
            onChange: (selectedDates, dateStr) => {
                state[prefix].selectedDate = dateStr;   // Save here
                fetchBookings(room, dateStr);
            }
        });
        state[prefix].datePickerInstance = dp;

        todayBtn.addEventListener('click', () => {
            dp.setDate('today', true);
            // onChange will fire and update state
        });

        const renderBookedTimes = bookings => {
            bookedList.innerHTML = '';
            if (!bookings.length) {
                bookedList.innerHTML = '<p style="text-align:center;">No bookings for this date. All clear!</p>';
                return;
            }
            bookings.sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));
            bookings.forEach(b => {
                const div = document.createElement('div');
                div.className = 'booked-slot';
                let status = '';
                if (state[prefix].selectedDate === todayStr()) {
                    const now = new Date().getHours() * 60 + new Date().getMinutes();
                    const bs = timeToMinutes(b.startTime), be = timeToMinutes(b.endTime);
                    if (bs <= now && now < be) {
                        div.classList.add('ongoing');
                        status = '<span class="status-label status-ongoing">Ongoing</span>';
                    } else if (be <= now) {
                        div.classList.add('done');
                        status = '<span class="status-label">Done</span>';
                    } else {
                        div.classList.add('upcoming');
                        status = '<span class="status-label status-upcoming">Upcoming</span>';
                    }
                } else {
                    div.classList.add('upcoming');
                    status = '<span class="status-label status-upcoming">Upcoming</span>';
                }
                div.innerHTML = `
                    <div><strong>${b.startTime} - ${b.endTime}</strong><span>${b.name} - ${b.project}</span></div>
                    <div>${status}<button class="delete-btn" data-id="${b.id}">x</button></div>
                `;
                bookedList.appendChild(div);
            });
            bookedList.querySelectorAll('.delete-btn').forEach(btn => {
                btn.onclick = () => {
                    const pw = prompt("Enter cancelation password:");
                    if (pw !== null) deleteBooking(room, btn.dataset.id, pw.trim());
                };
            });
        };

        const populateTimeSelectors = bookedSlots => {
            startSel.innerHTML = ''; endSel.innerHTML = '';
            const now = new Date();
            const today = todayStr();
            const curMin = now.getHours() * 60 + now.getMinutes();
            const interval = 30;

            if (state[prefix].selectedDate === today) {
                const nowStr = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
                const opt = document.createElement('option');
                opt.value = nowStr;
                opt.textContent = `Now (${nowStr})`;
                opt.classList.add('now-option');
                const checkEnd = `${pad(now.getHours())}:${pad(now.getMinutes() + 1)}`;
                if (checkOverlap(bookedSlots, nowStr, checkEnd)) {
                    opt.disabled = true;
                    opt.classList.add('unavailable');
                }
                startSel.appendChild(opt);
            }

            for (let i = 0; i < 24 * 60 / interval; i++) {
                const mins = i * interval;
                const time = `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`;
                const opt = document.createElement('option');
                opt.value = time; opt.textContent = time;
                const past = state[prefix].selectedDate === today && mins <= curMin;
                const booked = checkOverlap(bookedSlots, time, `${pad(Math.floor((mins + interval) / 60))}:${pad((mins + interval) % 60)}`);
                if (past || booked) { opt.disabled = true; opt.classList.add('unavailable'); }
                startSel.appendChild(opt);
            }

            const updateEnd = () => {
                endSel.innerHTML = '';
                const s = startSel.value;
                if (!s) return;
                const startMins = timeToMinutes(s);
                for (let i = Math.ceil(startMins / interval) + 1; i <= 24 * 60 / interval; i++) {
                    const mins = i * interval;
                    const time = `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`;
                    const opt = document.createElement('option');
                    opt.value = time; opt.textContent = time;
                    if (checkOverlap(bookedSlots, s, time)) { opt.disabled = true; opt.classList.add('unavailable'); }
                    endSel.appendChild(opt);
                }
            };
            startSel.addEventListener('change', updateEnd);
            updateEnd();
        };

        const fetchBookings = date => {
            if (!date) return;
            const q = query(collection(db, room.collection), where('date', '==', date));
            onSnapshot(q, snap => {
                const bookings = [];
                snap.forEach(doc => bookings.push({ ...doc.data(), id: doc.id }));
                renderBookedTimes(bookings);
                populateTimeSelectors(bookings);
            });
        };

        checkBtn.addEventListener('click', () => {
            const start = startSel.value, end = endSel.value;
            const selectedDate = state[prefix].selectedDate;  // Read from state

            if (!selectedDate) return alert('Please select a date first.');
            if (!start || !end) return alert('Please select both start and end time.');
            if (timeToMinutes(end) <= timeToMinutes(start)) return alert('End time must be after start time.');

            modalRoomName.textContent = room.name;
            modalTimeSlot.textContent = `Time: ${start} - ${end} on ${selectedDate}`;
            bookingForm.dataset.startTime = start;
            bookingForm.dataset.endTime = end;
            bookingForm.dataset.room = prefix;
            modal.style.display = 'flex';
        });
    };

    ROOMS.forEach(initRoom);

    // Tab switching
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            document.querySelectorAll('.room-section').forEach(s => s.classList.remove('active'));
            document.getElementById(`section-${btn.dataset.room}`).classList.add('active');
        });
    });
    document.querySelector('.tab-btn').click();

    // Confirm Booking
    bookingForm.addEventListener('submit', async e => {
        e.preventDefault();
        const roomId = bookingForm.dataset.room;
        const room = ROOMS.find(r => r.id === roomId);
        const col = collection(db, room.collection);

        const name = document.getElementById('name').value.trim();
        const project = document.getElementById('project').value.trim();
        const deletePassword = document.getElementById('delete-password').value;
        const startTime = bookingForm.dataset.startTime;
        const endTime = bookingForm.dataset.endTime;
        const bookingDate = state[roomId].selectedDate;  // Correct date

        if (!bookingDate) return alert('No date selected.');
        if (deletePassword.length < 4) return alert('Password must be 4+ characters');

        try {
            const snap = await getDocs(query(col, where('date', '==', bookingDate)));
            const current = snap.docs.map(d => d.data());
            if (checkOverlap(current, startTime, endTime)) {
                alert('This slot was just booked. Please choose another.');
                modal.style.display = 'none';
                return;
            }

            await addDoc(col, {
                name, project, deletePassword,
                startTime, endTime, date: bookingDate,
                timestamp: serverTimestamp()
            });

            modal.style.display = 'none';
            document.getElementById('name').value = '';
            document.getElementById('project').value = '';
            document.getElementById('delete-password').value = '';

            successMessage.classList.add('visible-message');
            setTimeout(() => successMessage.classList.remove('visible-message'), 3000);

        } catch (err) {
            console.error(err);
            alert('Failed to book. Please try again.');
        }
    });

    const deleteBooking = async (room, id, pw) => {
        if (pw.length < 4) return alert('Password too short');
        const docRef = doc(db, room.collection, id);
        const snap = await getDoc(docRef);
        if (!snap.exists()) return alert('Booking not found');
        if (snap.data().deletePassword !== pw) return alert('Wrong password');
        await deleteDoc(docRef);
        alert('Booking deleted');
    };

    closeBtn.onclick = () => modal.style.display = 'none';
    window.onclick = e => { if (e.target === modal) modal.style.display = 'none'; };
});
