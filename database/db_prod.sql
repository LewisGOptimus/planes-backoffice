/*------------------------------------------------------*/
/*  DROPS & RESTART                                     */
/*------------------------------------------------------*/
-- Eliminar tablas del esquema accounting (de hijas a padres)
DROP TABLE IF EXISTS accounting.asientos_cuentas;
DROP TABLE IF EXISTS accounting.asientos;
DROP TABLE IF EXISTS accounting.cuentas;
DROP TABLE IF EXISTS accounting.centros_costos;
DROP TABLE IF EXISTS accounting.tipos_asiento;

-- Eliminar tablas del esquema core (de dependientes a dependencias)
DROP TABLE IF EXISTS core.terceros_telefonos;
DROP TABLE IF EXISTS core.terceros;
DROP TABLE IF EXISTS core.usuarios_empresas;
DROP TABLE IF EXISTS core.usuarios_telefonos;
DROP TABLE IF EXISTS core.empresas;
DROP TABLE IF EXISTS core.usuarios;

-- Eliminar tablas del esquema common (de hijas a padres)
DROP TABLE IF EXISTS common.telefonos;
DROP TABLE IF EXISTS common.municipios;
DROP TABLE IF EXISTS common.departamentos;
DROP TABLE IF EXISTS common.monedas;
DROP TABLE IF EXISTS common.tipos_identificacion;
DROP TABLE IF EXISTS common.regimenes_iva;
DROP TABLE IF EXISTS common.responsabilidades_tributarias;
DROP TABLE IF EXISTS common.naturalezas_empresariales;
DROP TABLE IF EXISTS common.paises;

-- Eliminar índices del esquema accounting
DROP INDEX IF EXISTS accounting.idx_cuentas_codigopath_gist;
DROP INDEX IF EXISTS accounting.idx_cuentas_empresa_codigo;
DROP INDEX IF EXISTS accounting.idx_asiento_empresa_fecha;
DROP INDEX IF EXISTS accounting.idx_asiento_cuentas_asiento;
DROP INDEX IF EXISTS accounting.idx_asiento_cuentas_cuenta;

-- Eliminar enums del esquema accounting
DROP TYPE IF EXISTS accounting.estado_asiento;
DROP TYPE IF EXISTS accounting.cartera;
DROP TYPE IF EXISTS accounting.naturaleza;
DROP TYPE IF EXISTS accounting.periodo;
DROP DOMAIN IF EXISTS accounting.partida_doble;

-- Eliminar enums del esquema core
DROP TYPE IF EXISTS core.periodo_facturacion;
DROP TYPE IF EXISTS core.tipo_token;
DROP TYPE IF EXISTS core.codigo_proveedor;
DROP TYPE IF EXISTS core.tipo_cuenta;

-- Eliminar enums del esquema common
DROP TYPE IF EXISTS common.tel_tipo;

-- Eliminar esquemas
DROP SCHEMA IF EXISTS accounting CASCADE;
DROP SCHEMA IF EXISTS core CASCADE;
DROP SCHEMA IF EXISTS common CASCADE;

-- Eliminar las extensiones
DROP EXTENSION IF EXISTS "uuid-ossp";
DROP EXTENSION IF EXISTS ltree;
DROP EXTENSION IF EXISTS unaccent;







/*------------------------------------------------------*/
/*  EXTENSIONES                                        */
/*------------------------------------------------------*/
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS ltree;
CREATE EXTENSION IF NOT EXISTS unaccent;

SET TIME ZONE 'UTC';



/*------------------------------------------------------*/
/*  COMMON - CONFIGURACIÓN                              */
/*------------------------------------------------------*/
CREATE SCHEMA IF NOT EXISTS common;

CREATE TYPE common.tel_tipo AS ENUM ('MOBILE', 'LANDLINE', 'VOIP', 'TOLL_FREE');


/*------------------------------------------------------*/
/*  COMMON - UBICACIÓN                                  */
/*------------------------------------------------------*/
CREATE TABLE common.paises (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    nombre          VARCHAR(255) NOT NULL,
    iso2            CHAR(2)  NOT NULL,   -- "CO"
    iso3            CHAR(3)  NOT NULL,      -- "COL"
    telefono_pref   VARCHAR(5) NOT NULL,     -- "+57"
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now(),
	
    UNIQUE (iso2)
);

CREATE TABLE common.monedas (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    codigo              VARCHAR(10) NOT NULL,
    nombre              VARCHAR(255) NOT NULL,
    simbolo             VARCHAR(10),
    decimales           INT,
    separador_decimal   VARCHAR(5),
    pais_id             UUID REFERENCES common.paises(id) ON DELETE RESTRICT,
    created_at          TIMESTAMPTZ DEFAULT now(),
    updated_at          TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE common.departamentos (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    codigo          VARCHAR(10) NOT NULL,
    nombre          VARCHAR(255) NOT NULL,
    pais_id         UUID REFERENCES common.paises(id) NOT NULL,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE common.municipios (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    codigo          VARCHAR(10) NOT NULL,
    nombre          VARCHAR(255) NOT NULL,
    departamento_id UUID REFERENCES common.departamentos(id) NOT NULL,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE common.retenciones (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    codigo              VARCHAR(10) NOT NULL,
    nombre              VARCHAR NOT NULL,
    factor              INT NOT NULL,
    created_at          TIMESTAMPTZ DEFAULT now(),
    updated_at          TIMESTAMPTZ DEFAULT now()
);


/*------------------------------------------------------*/
/*  COMMON - IDENTIFICACIONES & INFO PERSONAL           */
/*------------------------------------------------------*/
CREATE TABLE common.regimenes_iva (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    codigo          VARCHAR(10) NOT NULL,
    nombre          VARCHAR(255) NOT NULL,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE common.responsabilidades_tributarias (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    codigo          VARCHAR(10) NOT NULL,
    nombre          VARCHAR(255) NOT NULL,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE common.naturalezas_empresariales (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    codigo          VARCHAR(10) NOT NULL,
    nombre          VARCHAR(255) NOT NULL,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE common.tipos_identificacion (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    codigo          VARCHAR(10) NOT NULL,
    nombre          VARCHAR(255) NOT NULL,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);


CREATE TABLE common.telefonos (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    raw              TEXT NOT NULL,                 -- Sólo el número, sin prefijo
    e164             TEXT NOT NULL,                 -- "+573001234567"    (E.164 completo)
    pais_iso2        CHAR(2) NOT NULL REFERENCES common.paises(iso2),
    nsn              INT NOT NULL,                  -- national-significant-number: 10-12 dígitos
    ext              TEXT,                          -- extensión opcional
    tipo             common.tel_tipo NOT NULL,
    validado         BOOLEAN DEFAULT FALSE,         -- verificación externa (SMS / call)
    observaciones    TEXT,
    created_at       TIMESTAMPTZ DEFAULT now(),
    updated_at       TIMESTAMPTZ DEFAULT now()
);





/*------------------------------------------------------*/
/*  CORE - CONFIGURACIÓN                                */
/*------------------------------------------------------*/
CREATE SCHEMA IF NOT EXISTS core;

CREATE TYPE core.tipo_cuenta            AS ENUM ('CONTADOR', 'PROPIETARIO');
CREATE TYPE core.tipo_usuario           AS ENUM ('USUARIO', 'SUBUSUARIO');
CREATE TYPE core.codigo_proveedor       AS ENUM ('EMAIL', 'GOOGLE');
CREATE TYPE core.tipo_token             AS ENUM ('VERIFICAR', 'RESTABLECER');
CREATE TYPE core.periodo_facturacion    AS ENUM ('MENSUAL', 'TRIMESTRAL', 'ANUAL');
CREATE TYPE core.estado_asignacion      AS ENUM ('PENDIENTE', 'ASIGNADO', 'DESHABILITADO');
CREATE TYPE core.modulo                 AS ENUM ('CONTABILIDAD', 'NÓMINA', 'PEDIDOS');
CREATE TYPE core.recurso                 AS ENUM ('PUC', 'TIPOS DE ASIENTO', 'TERCEROS', 'ESPECIALES', 'COMPROBANTES');
CREATE TYPE core.estado_cola            AS ENUM ('RECIBIDO', 'EN_PROCESO', 'PROCESADO', 'FALLIDO');


/*------------------------------------------------------*/
/*  CORE - IDENTIDAD + SESIONES                        */
/*------------------------------------------------------*/
CREATE TABLE core.usuarios (
    -- meta info
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    prop_id             UUID REFERENCES core.usuarios(id),   -- requerido en subusuario
    sub                 TEXT NOT NULL UNIQUE,
    tipo_cuenta         core.tipo_cuenta NOT NULL,          -- 'contador | propietario'
    tipo_usuario        core.tipo_usuario NOT NULL,          -- 'usuario | subusuario'
    cambiar_contrasena  BOOLEAN DEFAULT FALSE,
    correo_verificado   BOOLEAN DEFAULT FALSE,
    username            TEXT,
    activo              BOOLEAN DEFAULT TRUE,                -- deshabilita login (en aplicación y auth0)
    eliminado           BOOLEAN DEFAULT FALSE,               -- propiedad para soft-delete

    -- info
    primer_nombre       TEXT,
    primer_apellido     TEXT,
    correo              TEXT,                                -- opcional (solo normal)
    es_admin            BOOLEAN DEFAULT FALSE,
    municipio_id        UUID REFERENCES common.municipios(id),
    fecha_nacimiento    DATE,
    created_at          TIMESTAMPTZ DEFAULT now(),
    updated_at          TIMESTAMPTZ DEFAULT now(),

    -- Reglas por tipo
    CONSTRAINT chk_tipo_correo CHECK (
        (tipo_usuario = 'USUARIO' AND correo IS NOT NULL) OR
        (tipo_usuario = 'SUBUSUARIO' AND correo IS NULL)
    ),
    CONSTRAINT chk_tipo_owner CHECK (
        (tipo_usuario = 'USUARIO' AND prop_id IS NULL) OR
        (tipo_usuario = 'SUBUSUARIO' AND prop_id IS NOT NULL)
    ),
    CONSTRAINT chk_tipo_admin CHECK (
        (tipo_usuario <> 'SUBUSUARIO') OR (es_admin = FALSE)
    ),
    CONSTRAINT chk_tipo_municipio CHECK (
        (tipo_usuario = 'USUARIO' AND municipio_id IS NOT NULL) OR
        (tipo_usuario = 'SUBUSUARIO')
    )
);

CREATE TABLE core.usuarios_telefonos (
    usuario_id      UUID REFERENCES core.usuarios(id) ON DELETE CASCADE,
    telefono_id     UUID REFERENCES common.telefonos(id) ON DELETE CASCADE,
    es_principal    BOOLEAN DEFAULT FALSE,
    
    PRIMARY KEY (usuario_id, telefono_id)
);

CREATE TABLE core.empresas (
    id                              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    naturaleza_id                   UUID REFERENCES common.naturalezas_empresariales(id) NOT NULL,
    responsabilidad_tributaria_id   UUID REFERENCES common.responsabilidades_tributarias(id) NOT NULL,
    regimen_iva_id                  UUID REFERENCES common.regimenes_iva(id) NULL,
    tipo_documento_id               UUID REFERENCES common.tipos_identificacion(id) NOT NULL,
    api_key                         TEXT NULL,
    numero_documento                VARCHAR(20) NOT NULL,
    razon_social                    VARCHAR(255) NULL,
    nombre_comercial                VARCHAR(255) NULL,
	primer_nombre                   VARCHAR(60) NULL,
	segundo_nombre                  VARCHAR(60) NULL,
	primer_apellido                 VARCHAR(60) NULL,
	segundo_apellido                VARCHAR(60) NULL,
    correo                          TEXT NULL,
    municipio_id                    UUID REFERENCES common.municipios(id) NOT NULL,
    direccion                       VARCHAR(255) NULL,
    nombre_logo                     TEXT NULL,
    anios_fiscales_disponibles      INTEGER[] DEFAULT ARRAY[EXTRACT(YEAR FROM CURRENT_DATE)],
    timezone                        VARCHAR(50) NOT NULL DEFAULT 'America/Bogota',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE core.usuarios_empresas (
    usuario_id UUID REFERENCES core.usuarios(id) ON DELETE CASCADE,
    empresa_id UUID REFERENCES core.empresas(id) ON DELETE CASCADE,
    es_propietario BOOLEAN DEFAULT FALSE,
    
    PRIMARY KEY (usuario_id, empresa_id)
);

CREATE TABLE core.terceros (
    id                          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    empresa_id                  UUID REFERENCES core.empresas(id) NOT NULL,
    cliente                     BOOLEAN NOT NULL DEFAULT false,
    proveedor                   BOOLEAN NOT NULL DEFAULT false,
    otros                       BOOLEAN NOT NULL DEFAULT false,

    -- Datos legales
    naturaleza_id               UUID REFERENCES common.naturalezas_empresariales(id) NOT NULL,
    resp_tributaria_id          UUID REFERENCES common.responsabilidades_tributarias(id) NOT NULL,
    regimen_iva_id              UUID REFERENCES common.regimenes_iva(id) NULL,
    tipo_identificacion_id      UUID REFERENCES common.tipos_identificacion(id) NOT NULL,
    numero_documento            VARCHAR(60) NOT NULL,
    razon_social                VARCHAR(100) NOT NULL,
    nombre_comercial            VARCHAR(100) NULL,
    primer_nombre               VARCHAR(100) NULL,
    segundo_nombre              VARCHAR(100) NULL,
    primer_apellido             VARCHAR(100) NULL,
    segundo_apellido            VARCHAR(100) NULL,

    -- Datos contacto nacional / internacional
    direccion                   VARCHAR(150) NOT NULL,
    municipio_id                UUID REFERENCES common.municipios(id) NULL,
    correo                      VARCHAR(100) NULL,

    extranjero                  BOOLEAN NOT NULL DEFAULT false,
    pais_id                     UUID REFERENCES common.paises(id) NULL,
    estado                      VARCHAR(100) NULL,
    ciudad                      VARCHAR(100) NULL,

    created_at                  TIMESTAMPTZ DEFAULT now(),
    updated_at                  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE core.terceros_telefonos (
    tercero_id      UUID REFERENCES core.terceros(id) ON DELETE CASCADE,
    telefono_id     UUID REFERENCES common.telefonos(id) ON DELETE CASCADE,
    es_principal    BOOLEAN DEFAULT FALSE,
    
    PRIMARY KEY (tercero_id, telefono_id)
);


/*------------------------------------------------------*/
/*  CORE - RBAC                                         */
/*------------------------------------------------------*/
CREATE TABLE core.permisos (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    modulo      core.modulo NOT NULL,      -- 'contabilidad','nómina','produccion'
    recurso     core.recurso NOT NULL,      -- 'asientos','terceros','empleados','ordenes'
    accion      TEXT NOT NULL,      -- 'read','create','update','delete','approve','export','send'
	nombre		VARCHAR(100) NOT NUll, -- nombre 'friendly'
    descripcion TEXT,
    created_at  TIMESTAMPTZ DEFAULT now(),
    updated_at  TIMESTAMPTZ DEFAULT now()
);
-- Índices
CREATE UNIQUE INDEX IF NOT EXISTS permisos_uniq ON core.permisos (modulo, recurso, accion);


CREATE TABLE core.roles (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    empresa_id  UUID REFERENCES core.empresas(id) ON DELETE CASCADE, -- NULL => rol del sistema (plantilla)
    nombre      TEXT NOT NULL,
    descripcion TEXT,
    es_sistema  BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ DEFAULT now(),
    updated_at  TIMESTAMPTZ DEFAULT now(),

    CONSTRAINT roles_empresa_requerida_chk CHECK (es_sistema OR empresa_id IS NOT NULL)
);

CREATE TABLE core.roles_permisos (
    rol_id      UUID REFERENCES core.roles(id) ON DELETE CASCADE,
    permiso_id  UUID REFERENCES core.permisos(id) ON DELETE CASCADE,
    PRIMARY KEY (rol_id, permiso_id)
);

CREATE INDEX IF NOT EXISTS roles_permisos_rol_idx ON core.roles_permisos (rol_id);
CREATE INDEX IF NOT EXISTS roles_permisos_perm_idx ON core.roles_permisos (permiso_id);

CREATE TABLE core.usuarios_empresas_roles (
    usuario_id      UUID NOT NULL,
    empresa_id      UUID NOT NULL,
    rol_id          UUID NOT NULL REFERENCES core.roles(id) ON DELETE CASCADE,
    estado          core.estado_asignacion NOT NULL DEFAULT 'ASIGNADO',
    vigente_desde   TIMESTAMPTZ DEFAULT now(),
    vigente_hasta   TIMESTAMPTZ,
    PRIMARY KEY (usuario_id, empresa_id, rol_id),

    -- Integridad: asegurar que exista la relación madre usuario-empresa
    CONSTRAINT uer_fk_usuario_empresa
        FOREIGN KEY (usuario_id, empresa_id)
        REFERENCES core.usuarios_empresas(usuario_id, empresa_id)
        ON DELETE CASCADE
);
-- Índices
CREATE INDEX IF NOT EXISTS uer_lookup_idx ON core.usuarios_empresas_roles (usuario_id, empresa_id, estado);

-- Un (1) rol activo por usuario y empresa
CREATE UNIQUE INDEX IF NOT EXISTS uer_un_rol_activo_por_empresa
  ON core.usuarios_empresas_roles (usuario_id, empresa_id)
  WHERE estado = 'ASIGNADO' AND vigente_hasta IS NULL;



/*------------------------------------------------------*/
/*  ACCOUNTING - CONFIGURACIÓN                          */
/*------------------------------------------------------*/
CREATE SCHEMA IF NOT EXISTS accounting;

CREATE TYPE accounting.periodo        AS ENUM ('ANUAL','MENSUAL');
CREATE TYPE accounting.periodo_operacion       AS ENUM ('CERRAR','ABRIR');
CREATE TYPE accounting.naturaleza      AS ENUM ('D','C');
CREATE TYPE accounting.cartera         AS ENUM ('C','P');
CREATE TYPE accounting.estado_asiento  AS ENUM ('ACTIVO','ANULADO');
CREATE TYPE accounting.tipo_saldo AS ENUM ('NORMAL', 'INICIAL', 'FINAL');
CREATE DOMAIN accounting.partida_doble AS CHAR(1) CHECK (VALUE IN ('D','C'));


/*------------------------------------------------------*/
/*  ACCOUNTING - TABLAS COMUNES                         */
/*------------------------------------------------------*/
CREATE TABLE accounting.centros_costos (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    empresa_id UUID REFERENCES core.empresas(id) NOT NULL,
    nombre     VARCHAR(250)      NOT NULL,
    created_at TIMESTAMPTZ       DEFAULT now(),
    updated_at TIMESTAMPTZ       DEFAULT now()
);

CREATE TABLE accounting.cierres_periodos (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    empresa_id      UUID REFERENCES core.empresas(id) NOT NULL,
    usuario_id      UUID REFERENCES core.usuarios(id) NOT NULL, -- Usuario que cierra el periodo
    tipo_cierre     accounting.periodo NOT NULL,
    operacion       accounting.periodo_operacion NOT NULL,
    valor           INTEGER NOT NULL, -- Año a cerrar ó mes (1-12) a cerrar
    anio            INTEGER, -- Año cuando el tipo es mensual
    fecha_cierre    DATE NOT NULL,
    activo          BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);

-- Índice para garantizar solo un registro activo por período
CREATE UNIQUE INDEX idx_cierres_periodos_activo_unico 
ON accounting.cierres_periodos (empresa_id, tipo_cierre, valor, anio) 
WHERE activo = true;



CREATE TABLE accounting.tipos_asiento (
    id               UUID DEFAULT uuid_generate_v4(),
    empresa_id       UUID REFERENCES core.empresas(id) ON DELETE CASCADE,
    tipo_saldo       accounting.tipo_saldo NOT NULL,
    codigo           VARCHAR(10)  NOT NULL,
    external_api     BOOLEAN NOT NULL DEFAULT false,
    nombre           VARCHAR(150) NOT NULL,
    anio_fiscal      SMALLINT NOT NULL,
    tipo_consecutivo accounting.periodo NOT NULL DEFAULT 'ANUAL',
    cons_anual       INT NOT NULL DEFAULT 1,
    cons_enero       INT NOT NULL DEFAULT 1,
    cons_febrero     INT NOT NULL DEFAULT 1,
    cons_marzo       INT NOT NULL DEFAULT 1,
    cons_abril       INT NOT NULL DEFAULT 1,
    cons_mayo        INT NOT NULL DEFAULT 1,
    cons_junio       INT NOT NULL DEFAULT 1,
    cons_julio       INT NOT NULL DEFAULT 1,
    cons_agosto      INT NOT NULL DEFAULT 1,
    cons_septiembre  INT NOT NULL DEFAULT 1,
    cons_octubre     INT NOT NULL DEFAULT 1,
    cons_noviembre   INT NOT NULL DEFAULT 1,
    cons_diciembre   INT NOT NULL DEFAULT 1,
    created_at       TIMESTAMPTZ DEFAULT now(),
    updated_at       TIMESTAMPTZ DEFAULT now(),

    PRIMARY KEY (id, anio_fiscal)
) PARTITION BY RANGE (anio_fiscal);

-- Índices
CREATE INDEX idx_tipos_asiento_empresa_anio ON accounting.tipos_asiento (empresa_id, anio_fiscal);

-- Partición default
CREATE TABLE accounting.tipos_asiento_def PARTITION OF accounting.tipos_asiento DEFAULT;







/*------------------------------------------------------*/
/*  ACCOUNTING - CUENTAS (PARTICIONADAS POR AÑO)        */
/*------------------------------------------------------*/
CREATE TABLE accounting.cuentas (
    id           UUID DEFAULT uuid_generate_v4(),
    empresa_id   UUID REFERENCES core.empresas(id) ON DELETE CASCADE,
    codigo_path  ltree        NOT NULL,
    codigo       VARCHAR(20)  GENERATED ALWAYS AS (subpath(codigo_path, nlevel(codigo_path)-1,1)) STORED,
    anio_fiscal  SMALLINT     NOT NULL,
    auxiliar     BOOLEAN      NOT NULL DEFAULT FALSE,
    nombre       VARCHAR(100) NOT NULL,
    naturaleza   accounting.naturaleza NOT NULL,
    centro_costo BOOLEAN      NOT NULL DEFAULT FALSE,
    tercero      BOOLEAN      NOT NULL DEFAULT FALSE,
    cartera      accounting.cartera NULL,
    activa       BOOLEAN      NOT NULL DEFAULT TRUE,
    PRIMARY KEY (id, anio_fiscal),
    UNIQUE (empresa_id, anio_fiscal, codigo_path)
) PARTITION BY RANGE (anio_fiscal);

-- Índices
CREATE INDEX idx_cuentas_codigopath_gist ON accounting.cuentas USING gist (codigo_path);
CREATE INDEX idx_cuentas_empresa_codigo  ON accounting.cuentas (empresa_id, codigo);
CREATE INDEX idx_cuentas_empresa_anio_path ON accounting.cuentas (empresa_id, anio_fiscal, codigo_path);

-- Partición default
CREATE TABLE accounting.cuentas_def PARTITION OF accounting.cuentas DEFAULT;





/*------------------------------------------------------*/
/*  ACCOUNTING - ASIENTOS (PARTICIONADOS POR AÑO)       */
/*------------------------------------------------------*/
CREATE TABLE accounting.asientos (
    id          UUID DEFAULT uuid_generate_v4(),
    cuip        VARCHAR NULL,
    empresa_id  UUID NOT NULL REFERENCES core.empresas(id) ON DELETE CASCADE,
    usuario_id  UUID NOT NULL REFERENCES core.usuarios(id) ON DELETE CASCADE,
    tipo_id     UUID NOT NULL,
    anio_fiscal SMALLINT NOT NULL,
    prefijo     VARCHAR(10),
    consecutivo INTEGER, -- Cambiar a string para soportar números de factura de compra/venta (ej. FV-FEP985)
    fecha       DATE     NOT NULL,
    descripcion TEXT,
    estado      accounting.estado_asiento NOT NULL DEFAULT 'ACTIVO',
    moneda      CHAR(3),
    motivo_anulacion TEXT,
    is_external_api BOOLEAN NOT NULL DEFAULT false,
    block       BOOLEAN NOT NULL DEFAULT false,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (id, anio_fiscal),
    UNIQUE (empresa_id, anio_fiscal, prefijo, consecutivo),

    FOREIGN KEY (tipo_id, anio_fiscal)
        REFERENCES accounting.tipos_asiento(id, anio_fiscal)
        ON DELETE RESTRICT
) PARTITION BY RANGE (anio_fiscal);

-- Índices
CREATE INDEX idx_asiento_empresa_anio ON accounting.asientos (empresa_id, anio_fiscal);

-- Partición default
CREATE TABLE accounting.asientos_def PARTITION OF accounting.asientos DEFAULT;






/*---------------------------------------------------------*/
/*  ACCOUNTING - ASIENTOS_CUENTAS (PARTICIONADOS POR AÑO)  */
/*---------------------------------------------------------*/
CREATE TABLE accounting.asientos_cuentas (
    id              UUID DEFAULT uuid_generate_v4(),
    asiento_id      UUID NOT NULL,
    cuenta_id       UUID NOT NULL,
    anio_fiscal     SMALLINT NOT NULL,
    concepto        TEXT,
    nro_factura     VARCHAR(30),
    centro_costo_id UUID REFERENCES accounting.centros_costos(id),
    tercero_id      UUID REFERENCES core.terceros(id),
    partida         accounting.partida_doble NOT NULL,
    valor           NUMERIC(18,2) NOT NULL CHECK (valor > 0),
    base            NUMERIC(18,2) NULL, -- Base sobre la que se calcula el importe
    porcentaje      NUMERIC(5,2) NULL, -- Porcentaje del impuesto/retención aplicado
    created_at      TIMESTAMPTZ    DEFAULT now(),
    updated_at      TIMESTAMPTZ    DEFAULT now(),

    PRIMARY KEY (id, asiento_id, anio_fiscal),

    FOREIGN KEY (asiento_id, anio_fiscal)
        REFERENCES accounting.asientos(id, anio_fiscal)
        ON DELETE RESTRICT,
    
    FOREIGN KEY (cuenta_id, anio_fiscal)
        REFERENCES accounting.cuentas(id, anio_fiscal)
        ON DELETE RESTRICT
) PARTITION BY RANGE (anio_fiscal);

-- Índices
CREATE INDEX idx_asiento_cuentas_asiento       ON accounting.asientos_cuentas (asiento_id, anio_fiscal);
CREATE INDEX idx_asiento_cuentas_cuenta        ON accounting.asientos_cuentas (cuenta_id, anio_fiscal);
CREATE INDEX idx_asiento_cuentas_centro_costo  ON accounting.asientos_cuentas (centro_costo_id, anio_fiscal);
CREATE INDEX idx_asiento_cuentas_tercero       ON accounting.asientos_cuentas (tercero_id, anio_fiscal);

-- Partición default
CREATE TABLE accounting.asientos_cuentas_def PARTITION OF accounting.asientos_cuentas DEFAULT;





/*---------------------------------------------------------*/
/*  ACCOUNTING - PRE-COMPROBANTE (PARTICIONADOS POR AÑO)   */
/*---------------------------------------------------------*/
CREATE TABLE accounting.pre_comprobantes (
    id              UUID DEFAULT uuid_generate_v4(),
    cuip            VARCHAR NOT NULL,
    empresa_id      UUID NOT NULL REFERENCES core.empresas(id) ON DELETE CASCADE,
    anio_fiscal     SMALLINT NOT NULL,
    estado          core.estado_cola NOT NULL,

    numero          VARCHAR NOT NULL, 
    intentos        INT DEFAULT(0), -- Repeticiones en colas
    payload         JSONB DEFAULT('{}'), -- Body del comprobante
    logs            JSONB DEFAULT('{}'), -- Registro interno del proceso
    mensajes        JSONB DEFAULT('{}'), -- Registro de mensajes a devolver al cliente en lenguaje natural

    last_job_id     VARCHAR,
    proccesed_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now(),

    PRIMARY KEY (id, empresa_id, anio_fiscal, numero),

    UNIQUE (empresa_id, anio_fiscal, numero)
) PARTITION BY RANGE (anio_fiscal);

-- Partición default
CREATE TABLE accounting.pre_comprobantes_def PARTITION OF accounting.pre_comprobantes DEFAULT;






/*---------------------------------------------------------*/
/*  ACCOUNTING - ANEXOS                                    */
/*---------------------------------------------------------*/
CREATE TABLE accounting.anexos(
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    empresa_id      UUID NOT NULL REFERENCES core.empresas(id) ON DELETE CASCADE,
    codigo          VARCHAR(3) NOT NULL,
    nombre          VARCHAR(100) NOT NULL,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);

-- Índices




/*---------------------------------------------------------*/
/*  ACCOUNTING - ANEXOS_CUENTAS (PARTICIONADOS POR AÑO)    */
/*---------------------------------------------------------*/
CREATE TABLE accounting.anexos_cuentas(
    anexo_id        UUID NOT NULL REFERENCES accounting.anexos(id) ON DELETE CASCADE,
    cuenta_id       UUID NOT NULL,
    porcentaje      NUMERIC(5,2) NOT NULL CHECK (porcentaje > 0 AND porcentaje <= 100),
    naturaleza      accounting.naturaleza NOT NULL,
    factor          INT NULL,
    anio_fiscal     SMALLINT NOT NULL,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now(),

    PRIMARY KEY (anexo_id, cuenta_id, anio_fiscal),

    FOREIGN KEY (cuenta_id, anio_fiscal)
        REFERENCES accounting.cuentas(id, anio_fiscal)
        ON DELETE RESTRICT
) PARTITION BY RANGE (anio_fiscal);

-- Índices

-- Partición default
CREATE TABLE accounting.anexos_cuentas_def PARTITION OF accounting.anexos_cuentas DEFAULT;





/*---------------------------------------------------------*/
/*  ACCOUNTING - AUDIT_LOG (PARTICIONADOS POR AÑO)  */
/*---------------------------------------------------------*/
CREATE TABLE IF NOT EXISTS accounting.audit_log (
    id              UUID            DEFAULT uuid_generate_v4(),
    fecha           TIMESTAMPTZ     NOT NULL DEFAULT now(),
    tabla           TEXT            NOT NULL,                               -- p.ej. 'accounting.asientos'
    accion          TEXT            NOT NULL CHECK (accion IN ('INSERT','UPDATE','DELETE')),
    reason          TEXT            NULL,
    statement_level BOOLEAN         NOT NULL DEFAULT FALSE,                 -- true si es snapshot por sentencia
    rows_affected   INTEGER         NOT NULL,                               -- nº de filas afectadas en la sentencia

    -- Contexto de negocio
    empresa_id      UUID,
    anio_fiscal     SMALLINT,                                               -- NULL => cae en partición DEFAULT
    usuario_id      UUID,
    correlation_id  UUID            NOT NULL,                               -- set explícito en INSERT

    -- Claves y datos
    asiento_id      UUID,                                                   -- si fue 1 fila (sencilla), sino NULL
    pk              JSONB,                                                  -- array de {id, anio_fiscal} afectados
    before_data     JSONB,                                                  -- objeto (1 fila) o array (masivo)
    after_data      JSONB,                                                   -- objeto (1 fila) o array (masivo)
    --before_hash     CHAR(32),
    --after_hash      CHAR(32),

    PRIMARY KEY (id, anio_fiscal)
) PARTITION BY RANGE (anio_fiscal);

-- Índices
CREATE INDEX IF NOT EXISTS idx_audit_empresa_anio ON accounting.audit_log (empresa_id, anio_fiscal);
CREATE INDEX IF NOT EXISTS idx_audit_tabla_accion_fecha ON accounting.audit_log (tabla, accion, fecha);
CREATE INDEX IF NOT EXISTS idx_audit_correlation ON accounting.audit_log (correlation_id);

-- Partición default
CREATE TABLE IF NOT EXISTS accounting.audit_log_def PARTITION OF accounting.audit_log DEFAULT;


/*--------------------------------------------------------------*/
/*  ACCOUNTING - TABLAS DE MAYORIZACIÓN (PARTICIONADAS POR AÑO) */
/*--------------------------------------------------------------*/
CREATE TABLE accounting.mayorizacion_cuenta (
    empresa_id  UUID     NOT NULL,
    cuenta_id   UUID     NOT NULL,
    anio_fiscal SMALLINT NOT NULL,
    mes         SMALLINT NOT NULL CHECK (mes BETWEEN 0 AND 13),
    debito      NUMERIC(18,2) DEFAULT 0,
    credito     NUMERIC(18,2) DEFAULT 0,
    saldo       NUMERIC(18,2) DEFAULT 0,
    PRIMARY KEY (empresa_id, cuenta_id, anio_fiscal, mes)
) PARTITION BY RANGE (anio_fiscal);

-- Índices
CREATE INDEX ON accounting.mayorizacion_cuenta (empresa_id, mes);

-- Partición default
CREATE TABLE accounting.mayorizacion_cuenta_def PARTITION OF accounting.mayorizacion_cuenta DEFAULT;





/*--------------------------------------------------------------*/
/*  ACCOUNTING - TABLAS DE MAYORIZACIÓN (CUENTA + TERCERO)      */
/*--------------------------------------------------------------*/
CREATE TABLE accounting.mayorizacion_cuenta_tercero (
    empresa_id  UUID     NOT NULL,
    cuenta_id   UUID     NOT NULL,
    tercero_id  UUID     NOT NULL,
    anio_fiscal SMALLINT NOT NULL,
    mes         SMALLINT NOT NULL CHECK (mes BETWEEN 0 AND 13),
    debito      NUMERIC(18,2) DEFAULT 0,
    credito     NUMERIC(18,2) DEFAULT 0,
    saldo       NUMERIC(18,2) DEFAULT 0,
    PRIMARY KEY (empresa_id, cuenta_id, tercero_id, anio_fiscal, mes)
) PARTITION BY RANGE (anio_fiscal);

-- Índices
CREATE INDEX ON accounting.mayorizacion_cuenta_tercero (tercero_id, mes);

-- Partición default
CREATE TABLE accounting.mayorizacion_cuenta_tercero_def PARTITION OF accounting.mayorizacion_cuenta_tercero DEFAULT;




/*------------------------------------------------------------------*/
/*  ACCOUNTING - TABLAS DE MAYORIZACIÓN (CUENTA + CENTRO DE COSTO)  */
/*------------------------------------------------------------------*/
CREATE TABLE accounting.mayorizacion_cuenta_cc (
    empresa_id      UUID     NOT NULL,
    cuenta_id       UUID     NOT NULL,
    centro_costo_id UUID     NOT NULL,
    anio_fiscal     SMALLINT NOT NULL,
    mes             SMALLINT NOT NULL CHECK (mes BETWEEN 0 AND 13),
    debito          NUMERIC(18,2) DEFAULT 0,
    credito         NUMERIC(18,2) DEFAULT 0,
    saldo           NUMERIC(18,2) DEFAULT 0,
    PRIMARY KEY (empresa_id, cuenta_id, centro_costo_id, anio_fiscal, mes)
) PARTITION BY RANGE (anio_fiscal);

CREATE INDEX ON accounting.mayorizacion_cuenta_cc (centro_costo_id, mes);

-- Partición default
CREATE TABLE accounting.mayorizacion_cuenta_cc_def
    PARTITION OF accounting.mayorizacion_cuenta_cc DEFAULT;