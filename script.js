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
        { id: 'upstairs',   name: 'Qala (قەڵا)',      collection: 'bookings_upstairs' }
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
        // An existing booking overlaps if its start is before our end AND its end is after our start.
        return bookings.some(b => timeToMinutes(b.startTime) < end && timeToMinutes(b.endTime) > start);
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
                // **FIX: Use state[prefix].selectedDate for status logic**
                if (state[prefix].selectedDate === todayStr()) {
                    const now = new Date().getHours() * 60 + new Date().getMinutes();
                    const bs = timeToMinutes(b.startTime), be = timeToMinutes(b.endTime);
                    if (bs <= now && now < be) {
                        div.classList.add('ongoing');
                        status = '<span class="status-label status-ongoing">Ongoing</span>';
                    } else if (be <= now) {
                        div.classList.add('done');
                        // Status label for done items is not explicitly styled in your CSS but we keep the logic
                        status = '<span class="status-label" style="background: #95a5a6;">Done</span>'; 
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
            const interval = 30; // 30 minute intervals

            const addOption = (select, mins, isStart) => {
                const time = `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`;
                const opt = document.createElement('option');
                opt.value = time; opt.textContent = time;
                
                let isBooked = false;
                // Check if this time slot (from time to time+interval) is booked
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
            
            // Add 'Now' option for today's date
            if (state[prefix].selectedDate === today) {
                const nowMins = now.getHours() * 60 + Math.ceil(now.getMinutes() / interval) * interval;
                const nowTime = `${pad(Math.floor(nowMins / 60))}:${pad(nowMins % 60)}`;
                if (timeToMinutes(nowTime) < timeToMinutes('24:00')) {
                    const opt = document.createElement('option');
                    opt.value = nowTime;
                    opt.textContent = `Start Now (${nowTime})`;
                    opt.classList.add('now-option');
                    
                    const nextTime = `${pad(Math.floor((nowMins + interval) / 60))}:${pad((nowMins + interval) % 60)}`;
                    if (checkOverlap(bookedSlots, nowTime, nextTime)) {
                        opt.disabled = true;
                        opt.classList.add('unavailable');
                    }
                    startSel.prepend(opt); // Prepend so it's the first available option
                }
            }
            

            const updateEnd = () => {
                endSel.innerHTML = '';
                const s = startSel.value;
                if (!s || startSel.selectedOptions[0].disabled) return; // Don't allow selecting an unavailable start time
                
                // Get the minutes of the selected START time
                const startMins = timeToMinutes(s); 
                
                // Iterate from one interval *after* the selected start time
                // i starts from the next slot index (i.e., if start is 10:00, next slot is 10:30)
                for (let i = Math.ceil(startMins / interval) + 1; i <= 24 * 60 / interval; i++) {
                    const mins = i * interval;
                    const time = `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`;
                    const opt = document.createElement('option');
                    opt.value = time; opt.textContent = time;
                    
                    // Check overlap from selected start time (s) up to this potential end time (time)
                    if (checkOverlap(bookedSlots, s, time)) { 
                        opt.disabled = true; 
                        opt.classList.add('unavailable'); 
                        // UX improvement: break loop after first unavailable end time to prevent booking past it.
                        // However, just disabling is safer.
                    }
                    endSel.appendChild(opt);
                }
                // Select the first available end time automatically
                endSel.value = endSel.querySelector('option:not(:disabled)') ? endSel.querySelector('option:not(:disabled)').value : '';
            };
            
            startSel.removeEventListener('change', updateEnd); // Prevent multiple listeners
            startSel.addEventListener('change', updateEnd);
            updateEnd();
        };

        const fetchBookings = date => {
            // **FIX 1: Ensure date is present**
            if (!date) {
                bookedList.innerHTML = '<p>Select a date to view bookings.</p>';
                populateTimeSelectors([]);
                return;
            }
            const q = query(collection(db, room.collection), where('date', '==', date));
            
            // onSnapshot provides real-time updates!
            onSnapshot(q, snap => {
                const bookings = [];
                snap.forEach(doc => bookings.push({ ...doc.data(), id: doc.id }));
                renderBookedTimes(bookings);
                populateTimeSelectors(bookings); // **CRUCIAL: Re-populate selectors with new bookings**
            });
        };

        // Flatpickr
        const dp = flatpickr(dateInput, {
            minDate: "today",
            dateFormat: "Y-m-d",
            // **FIX 1: onChange is the primary data fetching trigger**
            onChange: (selectedDates, dateStr) => {
                state[prefix].selectedDate = dateStr; 
                fetchBookings(dateStr);
            }
        });
        state[prefix].datePickerInstance = dp;
        
        // **FIX 1: Initial call to set today's date and fire onChange**
        dp.setDate('today', true);

        todayBtn.addEventListener('click', () => {
            dp.setDate('today', true);
        });

        // **FIX 2: Perform check *before* showing the modal**
        checkBtn.addEventListener('click', async () => {
            const start = startSel.value, end = endSel.value;
            const selectedDate = state[prefix].selectedDate; 

            if (!selectedDate) return alert('Please select a date first.');
            // Prevent booking if selected option is disabled (a booked slot)
            if (startSel.selectedOptions[0].disabled || endSel.selectedOptions[0].disabled) {
                 return alert('The selected start or end time is already booked. Please choose another.');
            }
            if (!start || !end) return alert('Please select both start and end time.');
            if (timeToMinutes(end) <= timeToMinutes(start)) return alert('End time must be after start time.');

            // Pre-booking check (redundant but essential real-time check)
            const roomData = ROOMS.find(r => r.id === prefix);
            const col = collection(db, roomData.collection);
            
            try {
                const snap = await getDocs(query(col, where('date', '==', selectedDate)));
                const currentBookings = snap.docs.map(d => d.data());
                
                if (checkOverlap(currentBookings, start, end)) {
                    alert('This slot was just booked or is unavailable. Please choose another time.');
                    // Re-fetch to update the time selectors based on the latest data
                    fetchBookings(selectedDate); 
                    return; 
                }

                // If available, proceed to show modal
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

    // Tab switching
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            // **FIX 3: Ensure the room section is active when the tab is clicked**
            document.querySelectorAll('.room-section').forEach(s => s.classList.remove('active'));
            const roomSection = document.getElementById(`section-${btn.dataset.room}`);
            roomSection.classList.add('active');

            // Force a re-fetch for the newly active room if the date is already set
            const roomId = btn.dataset.room;
            if (state[roomId] && state[roomId].selectedDate) {
                // We don't call dp.setDate here because it would reset the time selections,
                // but onSnapshot will re-run when the room's data is first loaded (which should happen 
                // on initial page load thanks to the initRoom fix). 
                // A quick fix to ensure the active room loads its data again on tab switch 
                // is to manually trigger the data load function if needed, but the Flatpickr 
                // init should cover the first load. Let's rely on the init fix for now.
            }
        });
    });
    
    // Initial tab click to show the first room
    const firstTabBtn = document.querySelector('.tab-btn');
    if (firstTabBtn) {
        firstTabBtn.click();
    }


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
        const bookingDate = state[roomId].selectedDate; 

        if (!bookingDate) return alert('No date selected.');
        if (deletePassword.length < 4) return alert('Password must be 4+ characters');

        // Final check for overlap right before saving (race condition protection)
        try {
            const snap = await getDocs(query(col, where('date', '==', bookingDate)));
            const current = snap.docs.map(d => d.data());
            if (checkOverlap(current, startTime, endTime)) {
                alert('This slot was just booked by someone else. Please choose another.');
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
        try {
            const snap = await getDoc(docRef);
            if (!snap.exists()) return alert('Booking not found');
            if (snap.data().deletePassword !== pw) return alert('Wrong password');
            await deleteDoc(docRef);
            alert('Booking deleted successfully!');
        } catch (error) {
            console.error("Error deleting booking:", error);
            alert('Failed to delete booking. Please check your connection.');
        }
    };

    closeBtn.onclick = () => modal.style.display = 'none';
    window.onclick = e => { if (e.target === modal) modal.style.display = 'none'; };
});
const deleteBooking = async (room, id, pw) => {
        if (pw.length < 4) return alert('Cancelation failed: Password must be 4 or more characters.');
        
        const docRef = doc(db, room.collection, id);
        try {
            const snap = await getDoc(docRef);
            
            if (!snap.exists()) {
                return alert('Cancelation failed: Booking not found. It may have already been canceled.');
            }
            
            // Explicitly check the password
            if (snap.data().deletePassword !== pw) {
                return alert('Cancelation failed: Wrong password.');
            }
            
            // Password is correct, proceed with deletion
            await deleteDoc(docRef);
            // We rely on the onSnapshot listener to automatically update the UI after this!
            alert('✅ Booking successfully canceled!');
            
        } catch (error) {
            console.error("Error deleting booking:", error);
            alert('❌ Failed to cancel booking. Please try again or check your console for details.');
        }
    };

