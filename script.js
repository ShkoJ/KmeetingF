import { 
    collection, addDoc, deleteDoc, doc, getDoc, getDocs, query, where, onSnapshot, serverTimestamp 
} from "https://www.gstatic.com/firebasejs/12.4.0/firebase-firestore.js";

document.addEventListener('DOMContentLoaded', () => {
    const db = window.db;
    if (!db) return alert("Firebase not loaded. Please ensure the Firebase initialization script is correct in index.html.");

    const roomContent = document.getElementById('room-content');
    const modal = document.getElementById('booking-modal');
    const modalRoomName = document.getElementById('modal-room-name');
    const modalTimeSlot = document.getElementById('modal-time-slot');
    const bookingForm = document.getElementById('booking-form');
    const closeBtn = document.querySelector('.close-btn');
    const successMessage = document.getElementById('success-message');

    const ROOMS = [
        { id: 'downstairs', name: 'Minara (منارە)', collection: 'bookings_downstairs' },
        { id: 'upstairs',   name: 'Qala (قەڵا)',      collection: 'bookings_upstairs' }
    ];

    // Dynamic Room Section Generation (using the previous structure)
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

    const state = {};

    // --- Core Deletion Function with Case-Insensitive Fix ---
    const deleteBooking = async (room, id, pw) => {
        // 'pw' is the password entered by the user
        const inputPassword = pw.trim().toLowerCase(); // Normalize input password for comparison
        
        if (inputPassword.length < 4) return alert('Cancelation failed: Password must be 4 or more characters.');
        
        const docRef = doc(db, room.collection, id); 
        try {
            const snap = await getDoc(docRef);
            
            if (!snap.exists()) {
                return alert('Cancelation failed: Booking not found. It may have already been canceled.');
            }
            
            // CRITICAL FIX: Normalize stored password for case-insensitive comparison
            const storedPassword = snap.data().deletePassword.trim().toLowerCase(); 
            
            if (storedPassword !== inputPassword) { 
                return alert('Cancelation failed: Wrong password.'); 
            }
            
            await deleteDoc(docRef);
            alert('✅ Booking successfully canceled!');
            
        } catch (error) {
            console.error("Error deleting booking:", error);
            alert('❌ Failed to cancel booking. Please try again or check your console for details.');
        }
    };
    // ------------------------------------------------

    const initRoom = room => {
        const prefix = room.id;
        const dateInput = document.getElementById(`booking-date-${prefix}`);
        const startSel = document.getElementById(`start-time-${prefix}`);
        const endSel = document.getElementById(`end-time-${prefix}`);
        const checkBtn = document.querySelector(`.book-btn[data-room="${prefix}"]`);
        const bookedList = document.getElementById(`booked-times-list-${prefix}`);
        const todayBtn = document.querySelector(`.today-btn[data-room="${prefix}"]`);

        state[prefix] = {
            selectedDate: '',
            datePickerInstance: null
        };

        const renderBookedTimes = bookings => {
            bookedList.innerHTML = '';
            if (!bookings.length) {
                bookedList.innerHTML = '<p style="text-align:center; color: #27ae60;">No bookings for this date. All clear!</p>';
                return;
            }
            bookings.sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));
            bookings.forEach(b => {
                const div = document.createElement('div');
                div.className = 'booked-slot';
                let status = '';
                const today = todayStr();
                const now = new Date().getHours() * 60 + new Date().getMinutes();
                const bs = timeToMinutes(b.startTime), be = timeToMinutes(b.endTime);

                if (state[prefix].selectedDate === today) {
                    if (bs <= now && now < be) {
                        div.classList.add('ongoing');
                        status = '<span class="status-label status-ongoing">Ongoing</span>';
                    } else if (be <= now) {
                        div.classList.add('done');
                        status = '<span class="status-label" style="background: #95a5a6;">Done</span>'; 
                    } else {
                        div.classList.add('upcoming');
                        status = '<span class="status-label status-upcoming">Upcoming</span>';
                    }
                } else {
                    div.classList.add('upcoming');
                    status = '<span class="status-label status-upcoming">Upcoming</span>';
                }
                
                const timeDiv = document.createElement('div');
                timeDiv.innerHTML = `
                    <strong>${b.startTime} - ${b.endTime}</strong>
                    <span>${b.name} - ${b.project}</span>
                `;
                
                const controlDiv = document.createElement('div');
                controlDiv.innerHTML = status;
                
                const deleteButton = document.createElement('button');
                deleteButton.className = 'delete-btn';
                deleteButton.dataset.id = b.id;
                deleteButton.textContent = 'x';
                
                deleteButton.onclick = () => {
                    const pw = prompt(`Enter cancelation password for ${b.startTime}-${b.endTime} meeting:`);
                    if (pw !== null) deleteBooking(room, deleteButton.dataset.id, pw.trim());
                };
                controlDiv.appendChild(deleteButton);

                div.appendChild(timeDiv);
                div.appendChild(controlDiv);

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

            // Start Time Selector Population
            for (let i = 0; i < 24 * 60 / interval; i++) {
                const mins = i * interval;
                addOption(startSel, mins, true);
            }
            
            // Add 'Now' option
            if (state[prefix].selectedDate === today) {
                const nowMins = Math.ceil((now.getHours() * 60 + now.getMinutes()) / interval) * interval;
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
                bookedList.innerHTML = '<p>Select a date to view bookings.</p>';
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

        // Flatpickr initialization
        const dp = flatpickr(dateInput, {
            minDate: "today",
            dateFormat: "Y-m-d",
            onChange: (selectedDates, dateStr) => {
                state[prefix].selectedDate = dateStr; 
                fetchBookings(dateStr);
            }
        });
        state[prefix].datePickerInstance = dp;
        
        dp.setDate('today', true);

        todayBtn.addEventListener('click', () => {
            dp.setDate('today', true);
        });

        // Pre-booking check
        checkBtn.addEventListener('click', async () => {
            const start = startSel.value, end = endSel.value;
            const selectedDate = state[prefix].selectedDate; 

            if (!selectedDate) return alert('Please select a date first.');
            if (startSel.selectedOptions[0].disabled || endSel.selectedOptions.length === 0 || endSel.selectedOptions[0].disabled) {
                 return alert('The selected time slot is already booked or invalid. Please choose another.');
            }
            if (!start || !end) return alert('Please select both start and end time.');
            if (timeToMinutes(end) <= timeToMinutes(start)) return alert('End time must be after start time.');

            const roomData = ROOMS.find(r => r.id === prefix);
            const col = collection(db, roomData.collection);
            
            try {
                const snap = await getDocs(query(col, where('date', '==', selectedDate)));
                const currentBookings = snap.docs.map(d => d.data());
                
                if (checkOverlap(currentBookings, start, end)) {
                    alert('This slot was just booked by someone else. Please choose another time.');
                    fetchBookings(selectedDate); 
                    return; 
                }

                modalRoomName.textContent = room.name;
                modalTimeSlot.textContent = `Time: ${start} - ${end} on ${selectedDate}`;
                bookingForm.dataset.startTime = start;
                bookingForm.dataset.endTime = end;
                bookingForm.dataset.room = prefix;
                modal.style.display = 'flex';
                
            } catch (err) {
                console.error("Error during pre-booking check:", err);
                alert('An error occurred during availability check. Please try again.');
            }
        });
    };

    ROOMS.forEach(initRoom);

    // Tab switching logic
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            document.querySelectorAll('.room-section').forEach(s => s.classList.remove('active'));
            const roomSection = document.getElementById(`section-${btn.dataset.room}`);
            roomSection.classList.add('active');
        });
    });
    
    // Initial tab click
    const firstTabBtn = document.querySelector('.tab-btn');
    if (firstTabBtn) {
        firstTabBtn.click();
    }


    // Confirm Booking Submission
    bookingForm.addEventListener('submit', async e => {
        e.preventDefault();
        const roomId = bookingForm.dataset.room;
        const room = ROOMS.find(r => r.id === roomId);
        const col = collection(db, room.collection);

        const name = document.getElementById('name').value.trim();
        const project = document.getElementById('project').value.trim();
        // CRITICAL FIX: Trim and convert the password to lowercase when saving it to the database
        const deletePassword = document.getElementById('delete-password').value.trim().toLowerCase(); 
        const startTime = bookingForm.dataset.startTime;
        const endTime = bookingForm.dataset.endTime;
        const bookingDate = state[roomId].selectedDate; 

        if (!bookingDate) return alert('No date selected.');
        if (deletePassword.length < 4) return alert('Password must be 4+ characters');

        try {
            const snap = await getDocs(query(col, where('date', '==', bookingDate)));
            const current = snap.docs.map(d => d.data());
            if (checkOverlap(current, startTime, endTime)) {
                alert('This slot was just booked by someone else. Please choose another.');
                modal.style.display = 'none';
                return;
            }

            await addDoc(col, {
                name, project, deletePassword, // Save the trimmed, lowercase password
                startTime, endTime, date: bookingDate,
                timestamp: serverTimestamp()
            });

            modal.style.display = 'none';
            // Clear form fields after successful booking
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

    // Modal Control
    closeBtn.onclick = () => modal.style.display = 'none';
    window.onclick = e => { if (e.target === modal) modal.style.display = 'none'; };
});
