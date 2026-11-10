import { mode, signIn, demoUsers } from '../data/api.js';
import { ROLES } from '../auth.js';
import { esc, initials, toast } from '../ui.js';

// Supabase rejimida: email + parol (Supabase Auth). Demo rejimda: foydalanuvchini tanlash.
export function renderLogin(el, onDone) {
  const demo = mode === 'demo';
  const users = demo ? demoUsers() : [];
  el.innerHTML = `<div class="login"><div class="login-card">
    <div class="brand"><div class="brand-logo">A</div><div><b>AvtodriveCRM</b><small>Tizimga kirish</small></div></div>
    <form id="login-form" class="stack" style="gap:10px">
      <div class="fld"><label>Login (email)</label><input class="inp" name="email" type="email" placeholder="email@example.com" autocomplete="username" required></div>
      <div class="fld"><label>Parol</label><input class="inp" name="password" type="password" autocomplete="current-password" ${demo ? '' : 'required'}></div>
      <button class="btn primary" type="submit">Kirish</button>
    </form>
    ${demo ? `<div class="divider">Demo: bir bosishda kirish</div>
    <div class="demo-users">${users.map(u => `<button type="button" data-id="${u.id}"><span class="avatar">${esc(initials(u.full_name))}</span><span style="flex:1"><b>${esc(u.full_name)}</b><br><span class="muted small">${esc(u.email)}</span></span><span class="tag">${ROLES[u.role]}</span></button>`).join('')}</div>
    <p class="muted small" style="margin:14px 0 0">Demo rejimda parol tekshirilmaydi. Supabase ulanganda haqiqiy autentifikatsiya ishlaydi.</p>` : ''}
  </div></div>`;
  const form = el.querySelector('#login-form');
  form.onsubmit = async e => {
    e.preventDefault();
    const btn = form.querySelector('button');
    btn.disabled = true;
    try {
      await signIn(form.email.value, form.password.value);
      onDone();
    } catch (ex) {
      toast(ex.message, 'err');
      btn.disabled = false;
    }
  };
  el.querySelector('.demo-users')?.addEventListener('click', async e => {
    const b = e.target.closest('button[data-id]');
    if (!b) return;
    await signIn(b.dataset.id);
    onDone();
  });
}
