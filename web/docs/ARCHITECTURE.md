# Arquitectura por Modulos

Cada dominio sigue arquitectura hexagonal:

- domain: reglas puras y puertos
- application: casos de uso
- infrastructure: implementaciones tecnicas
- adapters: entrada/salida (HTTP, jobs, etc.)

Regla de dependencias:

- domain -> no depende de framework o base de datos
- application -> depende de domain
- infrastructure -> depende de application/domain
- adapters -> depende de application y mapea contratos externos