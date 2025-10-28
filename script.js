import { 
    collection, addDoc, deleteDoc, doc, getDoc, query, where, onSnapshot, serverTimestamp 
} from "https://www.gstatic.com/firebasejs/12.4.0/firebase-firestore.js";

document.addEventListener('DOMContentLoaded', () => {
    const db = window.db;
    if (!db) {
        alert("Firebase not initialized. Check console.");
        console.error("Firestore not available");
        return;
    }

    const roomContent = document.getElementById('room-content');
    const modal = document.getElementById('booking-modal');
    const modalRoomName = document.getElementById('modal-room-name');
    const modalTimeSlot = document.getElementById('modal-time-slot');
    const bookingForm = document.getElementById('booking-form');
    const closeBtn = document.querySelector('.close-btn');
    const successMessage = document.getElementById('success-message');

    const ROOMS = [
    { id: 'downstairs', name: 'منارە', collection: 'bookings_downstairs' },
    { id: 'upstairs',   name: 'قەڵا',     collection: 'bookings_upstairs' }
    ];

    // Build UI
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

    // Helpers
    const pad = n => String(n).padStart(2, '0');
    const timeToMinutes = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
    const getCurrentMinutes = () => { const n = new Date(); return n.getHours() * 60 + n.getMinutes(); };
    const todayStr = () => {
        const n = new Date();
        return `${n.getFullYear()}-${pad(n.getMonth() + 1)}-${pad(n.getDate())}`;
    };
    const checkOverlap = (bookings, s, e) => {
        const start = timeToMinutes(s), end = timeToMinutes(e);
        return bookings.some(b => {
            const bs = timeToMinutes(b.startTime), be = timeToMinutes(b.endTime);
            return start < be && end > bs;
        });
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

        const dp = flatpickr(dateInput, {
            minDate: "today",
            dateFormat: "Y-m-d",
            onChange: (sel, str) => {
                state[prefix].selectedDate = str;
                fetchBookings(room, str);
            }
        });
        state[prefix] = { datePicker: dp, selectedDate: null, bookings: [] };
        todayBtn.addEventListener('click', () => dp.setDate('today', true));

        const render = bookings => {
            bookedList.innerHTML = '';
            if (!bookings.length) {
                bookedList.innerHTML = '<p>No bookings for this date.</p>';
                return;
            }
            bookings.sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));
            bookings.forEach(b => {
                const div = document.createElement('div');
                div.className = 'booked-slot';
                let status = '';
                if (state[prefix].selectedDate === todayStr()) {
                    const now = getCurrentMinutes();
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
                    <div>
                        <strong>${b.startTime} - ${b.endTime}</strong>
                        <span>${b.name} - ${b.project}</span>
                    </div>
                    <div>${status}<button class="delete-btn" data-id="${b.id}">×</button></div>
                `;
                bookedList.appendChild(div);
            });

            bookedList.querySelectorAll('.delete-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const pw = prompt('Enter cancel password:');
                    if (pw !== null) deleteBooking(room, btn.dataset.id, pw.trim());
                });
            });
        };

        const populateTimes = bookings => {
            startSel.innerHTML = ''; endSel.innerHTML = '';
            const interval = 30;
            const today = todayStr();
            const curMin = getCurrentMinutes();

            if (state[prefix].selectedDate === today) {
                const now = new Date();
                const nowStr = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
                const opt = document.createElement('option');
                opt.value = nowStr;
                opt.textContent = `Now (${nowStr})`;
                opt.classList.add('now-option');
                const checkEnd = `${pad(now.getHours())}:${pad(now.getMinutes() + 1)}`;
                if (checkOverlap(bookings, nowStr, checkEnd)) {
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
                const booked = checkOverlap(bookings, time, `${pad(Math.floor((mins + interval) / 60))}:${pad((mins + interval) % 60)}`);
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
                    if (checkOverlap(bookings, s, time)) { opt.disabled = true; opt.classList.add('unavailable'); }
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
                state[prefix].bookings = bookings;
                render(bookings);
                populateTimes(bookings);
            }, err => {
                console.error(err);
                bookedList.innerHTML = '<p>Failed to load bookings.</p>';
            });
        };

        checkBtn.addEventListener('click', () => {
            const start = startSel.value, end = endSel.value;
            if (!state[prefix].selectedDate) return alert('Select a date');
            if (!start || !end) return alert('Select start & end time');
            if (timeToMinutes(end) <= timeToMinutes(start)) return alert('End must be after start');

            modalRoomName.textContent = room.name;
            modalTimeSlot.textContent = `${start} - ${end} on ${state[prefix].selectedDate}`;
            bookingForm.dataset.room = prefix;
            bookingForm.dataset.start = start;
            bookingForm.dataset.end = end;
            modal.style.display = 'flex';
        });
    };

    ROOMS.forEach(initRoom);

    // Tab switching
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const target = btn.dataset.room;
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            document.querySelectorAll('.room-section').forEach(s => s.classList.remove('active'));
            document.getElementById(`section-${target}`).classList.add('active');
        });
    });
    document.querySelector('.tab-btn').click();

    // Submit booking
    bookingForm.addEventListener('submit', async e => {
        e.preventDefault();
        const roomId = bookingForm.dataset.room;
        const room = ROOMS.find(r => r.id === roomId);
        const col = collection(db, room.collection);

        const name = document.getElementById('name').value.trim();
        const project = document.getElementById('project').value.trim();
        const pw = document.getElementById('delete-password').value;
        const start = bookingForm.dataset.start;
        const end = bookingForm.dataset.end;
        const date = state[roomId].selectedDate;

        if (pw.length < 4) return alert('Password must be 4+ characters');

        const q = query(col, where('date', '==', date));
        const snap = await getDocs(q);
        const current = snap.docs.map(d => d.data());
        if (checkOverlap(current, start, end)) return alert('Slot just taken – try again');

        await addDoc(col, {
            name, project, deletePassword: pw,
            startTime: start, endTime: end, date,
            timestamp: serverTimestamp()
        });

        modal.style.display = 'none';
        bookingForm.reset();
        successMessage.classList.add('visible-message');
        setTimeout(() => successMessage.classList.remove('visible-message'), 3000);
    });

    // Delete
    const deleteBooking = async (room, id, pw) => {
        if (pw.length < 4) return alert('Password too short');
        const docRef = doc(db, room.collection, id);
        const docSnap = await getDoc(docRef);
        if (!docSnap.exists()) return alert('Booking not found');
        if (docSnap.data().deletePassword !== pw) return alert('Wrong password');
        await deleteDoc(docRef);
        alert('Booking deleted');
    };

    // Modal close
    closeBtn.onclick = () => modal.style.display = 'none';
    window.onclick = e => { if (e.target === modal) modal.style.display = 'none'; };
});