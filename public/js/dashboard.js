// Dashboard functionality
let currentUser = null;
let webcamStreamTrack = null;
let capturedPhotoBase64 = null;
let allServices = []; // Store services globally for client-side filtering

document.addEventListener('DOMContentLoaded', async () => {
  currentUser = Auth.getUser();
  if (!currentUser) return; // auth.js will handle redirect

  // Display user profile info
  const userBadge = document.getElementById('userBadge');
  userBadge.innerHTML = `
    <span>${currentUser.username}</span>
    <span class="badge ${currentUser.role === 'admin' ? 'admin' : 'pending'}" style="margin: 0; padding: 0.15rem 0.5rem; font-size: 0.65rem;">
      ${currentUser.role === 'admin' ? 'Admin' : 'Operario'}
    </span>
  `;

  // Toggle roles views
  if (currentUser.role === 'admin') {
    document.getElementById('adminPanel').style.display = 'block';
    await initAdminDashboard();
  } else {
    document.getElementById('workerPanel').style.display = 'grid';
    await initWorkerDashboard();
  }
});

// --- TOAST NOTIFICATIONS HELPER ---
function showToast(message, type = 'success') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(20px)';
    toast.style.transition = 'all 0.5s ease';
    setTimeout(() => toast.remove(), 500);
  }, 3000);
}

// --- ADMIN DASHBOARD ---
async function initAdminDashboard() {
  await refreshAdminStats();
  await loadGlobalServices();
  await loadWorkersList();
  setupAdminEventListeners();
}

async function refreshAdminStats() {
  try {
    const response = await fetch('/api/reports/summary', {
      headers: Auth.getHeaders()
    });
    if (!response.ok) throw new Error('Error al obtener reporte');
    const data = await response.json();

    // Fill KPIs
    document.getElementById('kpiRevenueToday').textContent = `S/. ${data.revenueToday.toFixed(2)}`;
    document.getElementById('kpiServicesToday').textContent = data.servicesToday;
    document.getElementById('kpiTotalRevenue').textContent = `S/. ${data.totalRevenue.toFixed(2)}`;
    document.getElementById('kpiTotalServices').textContent = data.totalServices;

    // Render charts
    renderWorkerPerformanceChart(data.workerPerformance);
    renderServiceDistributionChart(data.serviceTypeDistribution);
  } catch (error) {
    console.error('Error stats:', error);
    showToast('No se pudieron actualizar las estadísticas', 'danger');
  }
}

function renderWorkerPerformanceChart(performanceData) {
  const container = document.getElementById('workerPerformanceChart');
  container.innerHTML = '';
  
  if (performanceData.length === 0) {
    container.innerHTML = '<p class="text-center" style="color: var(--text-muted);">No hay datos disponibles</p>';
    return;
  }

  // Find max earnings for percentage calculations
  const maxEarnings = Math.max(...performanceData.map(w => parseFloat(w.total_earnings)), 1);

  performanceData.forEach(worker => {
    const earnings = parseFloat(worker.total_earnings);
    const percentage = (earnings / maxEarnings) * 100;
    
    const barHtml = `
      <div class="chart-bar-group">
        <div class="chart-bar-label">
          <span>${worker.username} (${worker.services_count} serv.)</span>
          <span style="font-weight: 700;">S/. ${earnings.toFixed(2)}</span>
        </div>
        <div class="chart-bar-bg">
          <div class="chart-bar-fill" style="width: ${percentage}%"></div>
        </div>
      </div>
    `;
    container.insertAdjacentHTML('beforeend', barHtml);
  });
}

function renderServiceDistributionChart(distributionData) {
  const container = document.getElementById('serviceTypeChart');
  container.innerHTML = '';
  
  if (distributionData.length === 0) {
    container.innerHTML = '<p class="text-center" style="color: var(--text-muted);">No hay datos disponibles</p>';
    return;
  }

  const maxRevenue = Math.max(...distributionData.map(d => parseFloat(d.total_revenue)), 1);

  distributionData.forEach(item => {
    const revenue = parseFloat(item.total_revenue);
    const percentage = (revenue / maxRevenue) * 100;
    
    const barHtml = `
      <div class="chart-bar-group">
        <div class="chart-bar-label">
          <span>${item.service_type} (${item.count} serv.)</span>
          <span style="font-weight: 700;">S/. ${revenue.toFixed(2)}</span>
        </div>
        <div class="chart-bar-bg">
          <div class="chart-bar-fill" style="width: ${percentage}%; background: linear-gradient(90deg, var(--secondary), #10b981);"></div>
        </div>
      </div>
    `;
    container.insertAdjacentHTML('beforeend', barHtml);
  });
}

async function loadGlobalServices() {
  try {
    const response = await fetch('/api/services', {
      headers: Auth.getHeaders()
    });
    if (!response.ok) throw new Error('Error al obtener servicios');
    allServices = await response.json();
    applyFilters(); // Apply search/filters
  } catch (error) {
    console.error('Error load services:', error);
    showToast('Error al cargar lista de servicios', 'danger');
  }
}

function applyFilters() {
  const filterPlate = document.getElementById('filterPlate').value.toUpperCase().trim();
  const filterStatus = document.getElementById('filterStatus').value;
  const filterWorker = document.getElementById('filterWorker').value;

  const filtered = allServices.filter(s => {
    const matchesPlate = !filterPlate || s.plate.includes(filterPlate);
    const matchesStatus = !filterStatus || s.status === filterStatus;
    const matchesWorker = !filterWorker || String(s.worker_id) === filterWorker;
    return matchesPlate && matchesStatus && matchesWorker;
  });

  renderServicesList(filtered);
}

function renderServicesList(services) {
  const tbody = document.getElementById('servicesTableBody');
  const mobileList = document.getElementById('servicesMobileList');
  
  tbody.innerHTML = '';
  mobileList.innerHTML = '';

  if (services.length === 0) {
    tbody.innerHTML = '<tr><td colspan="10" class="text-center" style="color: var(--text-muted);">No se encontraron servicios</td></tr>';
    mobileList.innerHTML = '<p class="text-center" style="color: var(--text-muted); padding: 2rem;">No se encontraron servicios</p>';
    return;
  }

  services.forEach(s => {
    const dateStr = new Date(s.created_at).toLocaleString('es-ES', {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });

    const statusOptions = ['pending', 'in_progress', 'completed', 'delivered'];
    const statusLabels = {
      pending: 'Pendiente',
      in_progress: 'En Progreso',
      completed: 'Completado',
      delivered: 'Entregado'
    };

    let selectOptions = statusOptions.map(opt => 
      `<option value="${opt}" ${s.status === opt ? 'selected' : ''}>${statusLabels[opt]}</option>`
    ).join('');

    const imgPreviewHtml = s.photo_url 
      ? `<img src="${s.photo_url}" class="service-img-preview" onclick="openPhotoModal('${s.plate}', '${s.photo_url}')" alt="Foto">`
      : `<span style="color: var(--text-muted); font-size: 0.8rem;">Sin foto</span>`;

    const paymentLabel = s.payment_method === 'yape_plin' ? 'Yape/Plin' : (s.payment_method ? s.payment_method.charAt(0).toUpperCase() + s.payment_method.slice(1) : 'Efectivo');
    const vehicleLabel = s.vehicle_type || 'Auto';

    // Render desktop row
    const rowHtml = `
      <tr>
        <td><span class="service-plate-badge">${s.plate}</span></td>
        <td>${imgPreviewHtml}</td>
        <td style="font-weight:600;">${vehicleLabel}</td>
        <td style="font-weight:600;">${s.service_type}</td>
        <td style="font-weight:700;">S/. ${parseFloat(s.price).toFixed(2)}</td>
        <td style="font-weight:600; color:var(--text-secondary);">${paymentLabel}</td>
        <td>${s.worker_name || 'Sin asignar'}</td>
        <td>
          <select class="filter-input" style="padding: 0.25rem 0.5rem; font-size: 0.85rem; min-width: 120px;" onchange="updateServiceStatus(${s.id}, this.value)">
            ${selectOptions}
          </select>
        </td>
        <td style="color: var(--text-secondary); font-size: 0.85rem;">${dateStr}</td>
        <td style="text-align: center;">
          <button class="btn btn-danger" style="padding: 0.35rem 0.65rem; width: auto; font-size: 0.8rem;" onclick="deleteService(${s.id})">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
          </button>
        </td>
      </tr>
    `;
    tbody.insertAdjacentHTML('beforeend', rowHtml);

    // Render mobile card
    const cardHtml = `
      <div class="mobile-service-card">
        ${s.photo_url ? `<img src="${s.photo_url}" class="mobile-card-img" onclick="openPhotoModal('${s.plate}', '${s.photo_url}')" alt="Placa">` : '<div class="mobile-card-img" style="display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,0.05);color:var(--text-muted);font-size:0.8rem;">Sin foto</div>'}
        <div class="mobile-card-details">
          <div>
            <div class="mobile-card-plate" style="display:flex; justify-content:space-between; align-items:center;">
              <span class="service-plate-badge">${s.plate}</span>
              <span style="font-weight:700; color:var(--text-primary);">S/. ${parseFloat(s.price).toFixed(2)}</span>
            </div>
            <div style="font-weight:600; font-size:0.9rem; margin-top:0.25rem;">${s.service_type} (${vehicleLabel})</div>
            <div class="mobile-card-meta">Pago: ${paymentLabel} | Operario: ${s.worker_name || 'N/A'}</div>
            <div class="mobile-card-meta" style="font-size: 0.75rem;">${dateStr}</div>
          </div>
          <div style="display:flex; align-items:center; justify-content:space-between; margin-top:0.5rem; gap: 0.5rem;">
            <select class="filter-input" style="padding: 0.25rem 0.5rem; font-size: 0.8rem; flex: 1;" onchange="updateServiceStatus(${s.id}, this.value)">
              ${selectOptions}
            </select>
            <button class="btn btn-danger" style="padding: 0.35rem 0.5rem; width: auto; font-size: 0.8rem;" onclick="deleteService(${s.id})">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
            </button>
          </div>
        </div>
      </div>
    `;
    mobileList.insertAdjacentHTML('beforeend', cardHtml);
  });
}

async function updateServiceStatus(id, newStatus) {
  try {
    const response = await fetch(`/api/services/${id}`, {
      method: 'PUT',
      headers: Auth.getHeaders(),
      body: JSON.stringify({ status: newStatus })
    });
    if (!response.ok) throw new Error('Error al actualizar estado');
    showToast('Estado del servicio actualizado correctamente', 'success');
    
    // Refresh local lists and stats
    await refreshAdminStats();
    await loadGlobalServices();
  } catch (error) {
    console.error('Error updating status:', error);
    showToast(error.message, 'danger');
  }
}

async function deleteService(id) {
  if (!confirm('¿Estás seguro de que deseas eliminar este registro de servicio?')) return;
  try {
    const response = await fetch(`/api/services/${id}`, {
      method: 'DELETE',
      headers: Auth.getHeaders()
    });
    if (!response.ok) throw new Error('Error al eliminar servicio');
    showToast('Servicio eliminado correctamente', 'success');
    await refreshAdminStats();
    await loadGlobalServices();
  } catch (error) {
    console.error('Error deleting:', error);
    showToast(error.message, 'danger');
  }
}

async function loadWorkersList() {
  try {
    const response = await fetch('/api/users', {
      headers: Auth.getHeaders()
    });
    if (!response.ok) throw new Error('Error al cargar personal');
    const workers = await response.json();

    // Populate worker filter in service list
    const filterWorkerSelect = document.getElementById('filterWorker');
    filterWorkerSelect.innerHTML = '<option value="">Todos los Empleados</option>';
    
    // Populate user table
    const tbody = document.getElementById('usersTableBody');
    tbody.innerHTML = '';

    workers.forEach(w => {
      // Add option to filters
      if (w.role === 'worker') {
        const opt = document.createElement('option');
        opt.value = w.id;
        opt.textContent = w.username;
        filterWorkerSelect.appendChild(opt);
      }

      // Add row to table
      const row = `
        <tr>
          <td style="font-weight:600;">${w.username}</td>
          <td>
            <span class="badge ${w.role === 'admin' ? 'completed' : 'pending'}">
              ${w.role === 'admin' ? 'Administrador' : 'Trabajador'}
            </span>
          </td>
        </tr>
      `;
      tbody.insertAdjacentHTML('beforeend', row);
    });
  } catch (error) {
    console.error('Error users list:', error);
  }
}

function setupAdminEventListeners() {
  // Live filters
  document.getElementById('filterPlate').addEventListener('input', applyFilters);
  document.getElementById('filterStatus').addEventListener('change', applyFilters);
  document.getElementById('filterWorker').addEventListener('change', applyFilters);

  // User form submission
  const userForm = document.getElementById('userForm');
  userForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('newUsername').value;
    const password = document.getElementById('newPassword').value;
    const role = document.getElementById('newRole').value;

    try {
      const response = await fetch('/api/users', {
        method: 'POST',
        headers: Auth.getHeaders(),
        body: JSON.stringify({ username, password, role })
      });
      const data = await response.json();

      if (!response.ok) throw new Error(data.error || 'Error al crear usuario');

      showToast(`Usuario "${data.username}" creado correctamente`, 'success');
      userForm.reset();
      await loadWorkersList(); // Refresh list
    } catch (error) {
      console.error('Create user error:', error);
      showToast(error.message, 'danger');
    }
  });
}

function switchTab(tabId, btn) {
  // Hide all tab contents
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  // Deactivate all tab buttons
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));

  // Show active tab
  document.getElementById(tabId).classList.add('active');
  btn.classList.add('active');
}


// --- WORKER DASHBOARD ---
async function initWorkerDashboard() {
  await loadWorkerServices();
  setupWorkerFormEvents();
}

async function loadWorkerServices() {
  try {
    const response = await fetch('/api/services', {
      headers: Auth.getHeaders()
    });
    if (!response.ok) throw new Error('Error al cargar tus servicios');
    const services = await response.json();
    renderWorkerServices(services);
  } catch (error) {
    console.error('Error loading worker services:', error);
    showToast(error.message, 'danger');
  }
}

function renderWorkerServices(services) {
  const tbody = document.getElementById('workerServicesTableBody');
  const mobileList = document.getElementById('workerServicesMobileList');
  tbody.innerHTML = '';
  mobileList.innerHTML = '';

  if (services.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="text-center" style="color: var(--text-muted);">No has registrado servicios hoy.</td></tr>';
    mobileList.innerHTML = '<p class="text-center" style="color: var(--text-muted); padding: 2rem;">No has registrado servicios hoy.</p>';
    return;
  }

  services.forEach(s => {
    const statusLabels = {
      pending: 'Pendiente',
      in_progress: 'En Progreso',
      completed: 'Completado',
      delivered: 'Entregado'
    };

    // Action button based on state
    let actionBtnHtml = '';
    if (s.status === 'pending') {
      actionBtnHtml = `<button class="btn btn-primary" style="padding: 0.35rem 0.75rem; width: auto; font-size: 0.75rem;" onclick="updateWorkerServiceStatus(${s.id}, 'in_progress')">Iniciar</button>`;
    } else if (s.status === 'in_progress') {
      actionBtnHtml = `<button class="btn btn-primary" style="padding: 0.35rem 0.75rem; width: auto; font-size: 0.75rem; background: linear-gradient(135deg, var(--secondary), #10b981);" onclick="updateWorkerServiceStatus(${s.id}, 'completed')">Terminar</button>`;
    } else {
      actionBtnHtml = `<span style="color: var(--text-muted); font-size: 0.75rem; font-weight:600;">Listo</span>`;
    }

    const imgPreviewHtml = s.photo_url 
      ? `<img src="${s.photo_url}" class="service-img-preview" onclick="openPhotoModal('${s.plate}', '${s.photo_url}')" alt="Foto">`
      : `<span style="color: var(--text-muted); font-size: 0.8rem;">Sin foto</span>`;

    const paymentLabel = s.payment_method === 'yape_plin' ? 'Yape/Plin' : (s.payment_method ? s.payment_method.charAt(0).toUpperCase() + s.payment_method.slice(1) : 'Efectivo');
    const vehicleLabel = s.vehicle_type || 'Auto';

    // Render desktop
    const row = `
      <tr>
        <td><span class="service-plate-badge">${s.plate}</span></td>
        <td>${imgPreviewHtml}</td>
        <td style="font-weight: 600;">${vehicleLabel}</td>
        <td style="font-weight: 600;">${s.service_type}</td>
        <td style="font-weight: 700;">S/. ${parseFloat(s.price).toFixed(2)}</td>
        <td style="font-weight: 600; color:var(--text-secondary);">${paymentLabel}</td>
        <td><span class="badge ${s.status}">${statusLabels[s.status]}</span></td>
        <td>${actionBtnHtml}</td>
      </tr>
    `;
    tbody.insertAdjacentHTML('beforeend', row);

    // Render mobile card
    const cardHtml = `
      <div class="mobile-service-card">
        ${s.photo_url ? `<img src="${s.photo_url}" class="mobile-card-img" onclick="openPhotoModal('${s.plate}', '${s.photo_url}')" alt="Foto Placa">` : '<div class="mobile-card-img" style="display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,0.05);color:var(--text-muted);font-size:0.8rem;">Sin foto</div>'}
        <div class="mobile-card-details">
          <div>
            <div class="mobile-card-plate" style="display:flex; justify-content:space-between; align-items:center;">
              <span class="service-plate-badge">${s.plate}</span>
              <span style="font-weight: 700;">S/. ${parseFloat(s.price).toFixed(2)}</span>
            </div>
            <div style="font-weight: 600; font-size:0.9rem; margin-top:0.25rem;">${s.service_type} (${vehicleLabel})</div>
            <div class="mobile-card-meta">Pago: ${paymentLabel}</div>
          </div>
          <div style="display:flex; align-items:center; justify-content:space-between; margin-top:0.5rem;">
            <span class="badge ${s.status}">${statusLabels[s.status]}</span>
            ${actionBtnHtml}
          </div>
        </div>
      </div>
    `;
    mobileList.insertAdjacentHTML('beforeend', cardHtml);
  });
}

async function updateWorkerServiceStatus(id, newStatus) {
  try {
    const response = await fetch(`/api/services/${id}`, {
      method: 'PUT',
      headers: Auth.getHeaders(),
      body: JSON.stringify({ status: newStatus })
    });
    if (!response.ok) throw new Error('Error al actualizar estado del servicio');
    showToast('Estado actualizado', 'success');
    await loadWorkerServices();
  } catch (error) {
    console.error('Error worker status update:', error);
    showToast(error.message, 'danger');
  }
}

function handleServiceTypeChange(select) {
  const customGroup = document.getElementById('customServiceGroup');
  const priceInput = document.getElementById('price');
  
  if (select.value === 'custom') {
    customGroup.style.display = 'block';
    document.getElementById('customServiceName').required = true;
    priceInput.value = '';
    priceInput.placeholder = '0.00';
  } else {
    customGroup.style.display = 'none';
    document.getElementById('customServiceName').required = false;
    const selectedOption = select.options[select.selectedIndex];
    priceInput.value = selectedOption.getAttribute('data-price');
  }
}

function setupWorkerFormEvents() {
  const serviceForm = document.getElementById('serviceForm');
  serviceForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const plate = document.getElementById('plate').value;
    const serviceSelect = document.getElementById('serviceType');
    const price = parseFloat(document.getElementById('price').value);
    const vehicleType = document.getElementById('vehicleType').value;
    const paymentMethod = document.getElementById('paymentMethod').value;
    
    let service_type = serviceSelect.value;
    if (service_type === 'custom') {
      service_type = document.getElementById('customServiceName').value.trim();
    }

    const submitBtn = document.getElementById('submitServiceBtn');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Guardando...';

    try {
      const response = await fetch('/api/services', {
        method: 'POST',
        headers: Auth.getHeaders(),
        body: JSON.stringify({
          plate,
          service_type,
          price,
          vehicle_type: vehicleType,
          payment_method: paymentMethod,
          photo_url: capturedPhotoBase64
        })
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Error al guardar servicio');

      showToast('Servicio registrado exitosamente', 'success');
      
      // Reset form and camera
      serviceForm.reset();
      resetPhotoCapture();
      
      // Select first service option and trigger price update
      serviceSelect.selectedIndex = 0;
      handleServiceTypeChange(serviceSelect);

      // Reset select dropdowns
      document.getElementById('vehicleType').selectedIndex = 0;
      document.getElementById('paymentMethod').selectedIndex = 0;

      // Reload list
      await loadWorkerServices();
    } catch (error) {
      console.error('Service save error:', error);
      showToast(error.message, 'danger');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Registrar Servicio';
    }
  });
}

// --- PHOTO CAPTURE & COMPRESSION LOGIC ---

function triggerPhotoUpload() {
  // If webcam stream is active, do nothing when clicking the box itself
  if (webcamStreamTrack) return;
  document.getElementById('photoFileInput').click();
}

function handlePhotoFile(input) {
  const file = input.files[0];
  if (!file) return;

  // Use Object URL instead of FileReader.readAsDataURL.
  // This loads instantly and saves massive amounts of RAM in mobile browsers.
  const objectUrl = URL.createObjectURL(file);
  
  // Wrap in a short timeout to prevent UI thread stuttering
  setTimeout(async () => {
    try {
      const compressed = await compressImage(objectUrl);
      capturedPhotoBase64 = compressed;
      
      // Display preview
      const photoPreview = document.getElementById('photoPreview');
      photoPreview.src = compressed;
      photoPreview.style.display = 'block';
      
      showToast('Foto cargada y optimizada', 'success');
    } catch (error) {
      console.error('Error compressing uploaded file:', error);
      showToast('Error al procesar la imagen.', 'danger');
    }
  }, 50);
}

function compressImage(imageSource) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 640;
        const MAX_HEIGHT = 480;
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > MAX_WIDTH) {
            height *= MAX_WIDTH / width;
            width = MAX_WIDTH;
          }
        } else {
          if (height > MAX_HEIGHT) {
            width *= MAX_HEIGHT / height;
            height = MAX_HEIGHT;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        
        // Output optimized JPEG (compressed ~ 0.6 quality to keep it fast & light)
        const result = canvas.toDataURL('image/jpeg', 0.6);
        
        // Revoke the object URL if it was a blob URL to release browser memory
        if (imageSource.startsWith('blob:')) {
          URL.revokeObjectURL(imageSource);
        }
        
        resolve(result);
      } catch (err) {
        if (imageSource.startsWith('blob:')) {
          URL.revokeObjectURL(imageSource);
        }
        reject(err);
      }
    };
    img.onerror = (err) => {
      if (imageSource.startsWith('blob:')) {
        URL.revokeObjectURL(imageSource);
      }
      reject(err);
    };
    img.src = imageSource;
  });
}

async function toggleWebcam(e) {
  e.preventDefault();
  const video = document.getElementById('webcamStream');
  const toggleBtn = document.getElementById('toggleWebcamBtn');
  const webcamActions = document.getElementById('webcamActions');
  const photoPreview = document.getElementById('photoPreview');

  // If already running, stop it
  if (webcamStreamTrack) {
    stopWebcamStream();
    return;
  }

  try {
    // Request environment facing camera (back camera)
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false
    });
    
    video.srcObject = stream;
    video.style.display = 'block';
    photoPreview.style.display = 'none';
    webcamActions.style.display = 'flex';
    toggleBtn.textContent = 'Usar Archivo / Galería';
    
    webcamStreamTrack = stream.getVideoTracks()[0];
  } catch (error) {
    console.error('Error accessing camera:', error);
    showToast('No se pudo acceder a la cámara en vivo. Usa galería.', 'warning');
  }
}

function stopWebcamStream() {
  const video = document.getElementById('webcamStream');
  const toggleBtn = document.getElementById('toggleWebcamBtn');
  const webcamActions = document.getElementById('webcamActions');
  
  if (webcamStreamTrack) {
    webcamStreamTrack.stop();
    webcamStreamTrack = null;
  }
  
  video.srcObject = null;
  video.style.display = 'none';
  webcamActions.style.display = 'none';
  toggleBtn.textContent = 'Usar Cámara en Vivo';
  
  // Restore photo preview if exists
  if (capturedPhotoBase64) {
    document.getElementById('photoPreview').style.display = 'block';
  }
}

async function captureWebcamSnapshot() {
  const video = document.getElementById('webcamStream');
  const canvas = document.createElement('canvas');
  
  canvas.width = video.videoWidth || 640;
  canvas.height = video.videoHeight || 480;
  
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  
  const rawBase64 = canvas.toDataURL('image/jpeg');
  const compressed = await compressImage(rawBase64);
  
  capturedPhotoBase64 = compressed;
  
  // Show preview
  const photoPreview = document.getElementById('photoPreview');
  photoPreview.src = compressed;
  photoPreview.style.display = 'block';
  
  stopWebcamStream();
  showToast('Foto capturada y optimizada', 'success');
}

function resetPhotoCapture() {
  stopWebcamStream();
  capturedPhotoBase64 = null;
  document.getElementById('photoPreview').src = '';
  document.getElementById('photoPreview').style.display = 'none';
  document.getElementById('photoFileInput').value = '';
}


// --- PHOTO EXPANSION MODAL WINDOW ---
function openPhotoModal(plate, photoUrl) {
  const modal = document.getElementById('photoModal');
  const modalTitle = document.getElementById('photoModalTitle');
  const modalImg = document.getElementById('photoModalImg');

  modalTitle.textContent = `Foto de Placa: ${plate}`;
  modalImg.src = photoUrl;
  modal.style.display = 'flex';
}

function closePhotoModal() {
  document.getElementById('photoModal').style.display = 'none';
}

// Close modal when clicking outside contents
window.onclick = function(event) {
  const modal = document.getElementById('photoModal');
  if (event.target === modal) {
    closePhotoModal();
  }
};
