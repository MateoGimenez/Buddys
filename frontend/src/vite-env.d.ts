/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Origen de la API cuando vive en otro dominio (ej. https://api.buddyswashdetail.com.ar). Vacío: mismo origen (/api). */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
