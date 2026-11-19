/**
 * Semáforo simple en memoria del proceso: como mucho `max` tareas a la vez; las demás esperan su turno en orden de
 * llegada (nunca se rechazan). Sirve para trabajo pesado de CPU o memoria, como re-codificar fotos con sharp.
 */
export class Semaforo {
  private ocupadosAhora = 0;
  private readonly cola: (() => void)[] = [];

  constructor(private readonly max: number) {
    if (!Number.isInteger(max) || max < 1) throw new Error('El semáforo necesita al menos un lugar.');
  }

  /** Tareas corriendo ahora. */
  get ocupados(): number {
    return this.ocupadosAhora;
  }

  /** Tareas esperando un lugar. */
  get esperando(): number {
    return this.cola.length;
  }

  /** Corre `tarea` cuando hay lugar y lo libera al terminar, salga bien o mal. */
  async usar<T>(tarea: () => Promise<T>): Promise<T> {
    // Se toma el lugar sin await en el medio: dos llamadas seguidas nunca ven el mismo hueco.
    if (this.ocupadosAhora < this.max) {
      this.ocupadosAhora += 1;
    } else {
      // El que libera le pasa su lugar directo (ocupadosAhora no baja): nadie se cuela entre medio.
      await new Promise<void>((resolve) => this.cola.push(resolve));
    }
    try {
      return await tarea();
    } finally {
      const siguiente = this.cola.shift();
      if (siguiente === undefined) this.ocupadosAhora -= 1;
      else siguiente();
    }
  }
}
