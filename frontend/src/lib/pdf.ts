/**
 * Abre un PDF que pide sesión. Se descarga con fetch (así pasa por el refresco de sesión) y se abre como blob.
 * La pestaña se abre antes de esperar la descarga para que el navegador del celular no la bloquee como popup.
 */
export async function abrirPdf(bajar: () => Promise<Blob>, nombre: string): Promise<void> {
  const pestana = window.open('', '_blank');
  try {
    const blob = await bajar();
    const url = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
    if (pestana) {
      pestana.location.href = url;
    } else {
      const a = document.createElement('a');
      a.href = url;
      a.download = nombre;
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 60_000);
  } catch (err) {
    pestana?.close();
    throw err;
  }
}
