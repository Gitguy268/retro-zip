// A classic script, because module scripts don't run from file:// at all.
if (location.protocol === 'file:') {
  addEventListener('DOMContentLoaded', () => { document.getElementById('file-note').hidden = false; });
}
