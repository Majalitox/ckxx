// Ayudantes para formularios (menús) de @minecraft/server-ui.
import { ActionFormData, ModalFormData, MessageFormData } from '@minecraft/server-ui';
import { sleep } from './compat.js';

const openForms = new Set();

/** Muestra un formulario reintentando si el jugador está ocupado (por ejemplo con el chat abierto). */
export async function show(form, player, tries = 8) {
  for (let i = 0; i < tries; i++) {
    let r;
    try {
      r = await form.show(player);
    } catch {
      return undefined;
    }
    if (r && r.canceled && r.cancelationReason === 'UserBusy') {
      await sleep(10);
      continue;
    }
    return r;
  }
  return undefined;
}

/**
 * Menú de botones. buttons: [{ text, icon?, fn? }]
 * Devuelve el índice elegido o undefined si se cerró.
 */
export async function buttons(player, title, body, list) {
  const f = new ActionFormData().title(title).body(body ?? '');
  for (const b of list) {
    if (b.icon) f.button(b.text, b.icon);
    else f.button(b.text);
  }
  const r = await show(f, player);
  if (!r || r.canceled || r.selection === undefined) return undefined;
  const b = list[r.selection];
  if (b && b.fn) await b.fn();
  return r.selection;
}

export async function confirm(player, title, body, yes = '§aSí', no = '§cNo') {
  const f = new MessageFormData().title(title).body(body).button1(yes).button2(no);
  const r = await show(f, player);
  return !!r && !r.canceled && r.selection === 0;
}

export async function info(player, title, body) {
  const f = new ActionFormData().title(title).body(body).button('§lVolver');
  await show(f, player);
}

/** Pide un texto al jugador. Devuelve la cadena o undefined. */
export async function ask(player, title, label, placeholder = '') {
  const f = new ModalFormData().title(title).textField(label, placeholder);
  f.submitButton('Enviar');
  const r = await show(f, player);
  if (!r || r.canceled || !r.formValues) return undefined;
  const v = r.formValues.find((x) => typeof x === 'string');
  return v === undefined ? undefined : String(v);
}

/** Desplegable simple: devuelve el índice elegido. */
export async function choose(player, title, label, options) {
  const f = new ModalFormData().title(title).dropdown(label, options);
  f.submitButton('Aceptar');
  const r = await show(f, player);
  if (!r || r.canceled || !r.formValues) return undefined;
  const v = r.formValues.find((x) => typeof x === 'number');
  return v;
}

export function isOpen(player) {
  return openForms.has(player.id);
}

/** Ejecuta una interfaz evitando abrir dos a la vez para el mismo jugador. */
export async function guarded(player, fn) {
  if (openForms.has(player.id)) return;
  openForms.add(player.id);
  try {
    await fn();
  } catch (e) {
    console.warn('[Aetheria] Error en interfaz: ' + e + (e && e.stack ? '\n' + e.stack : ''));
  } finally {
    openForms.delete(player.id);
  }
}
