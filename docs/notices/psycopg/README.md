# Optional PostgreSQL driver evidence

The `postgres` extra declares `psycopg[binary]==3.2.13`. The project remains MIT;
the optional driver is a separate LGPL-3.0-only dependency. This directory
retains the exact driver license from the verified pure-Python wheel.

UPSTREAM.json records three SHA256-verified artifacts: the pure-Python driver
and CPython 3.12 macOS ARM64 / manylinux x86_64 binary wheels. They were read as
ZIP data, never installed or imported. The binary wheels contain respectively
13 and 16 native files, including their two Python bindings. Client libraries
include libpq, OpenSSL, Kerberos, LDAP and SASL; the Linux wheel has additional
libraries listed in the inventory. Library versions and component licenses are
not established by filenames.

Each inspected wheel has one separate license file, the same LGPL text.
No separate component notices or corresponding-source inventory was identified
in the wheel paths. This evidence does not clear redistribution of those native
libraries. The LGPL's combined-work provisions address notices, license copies
and modification/relinking or corresponding-source arrangements; read the
retained section 4 before choosing an artifact distribution plan.

The application wheel declares the optional dependency instead of embedding
these libraries. Default SQLite installation does not select this extra.
For any proposed PostgreSQL container or native redistribution, first choose
the exact target artifact and review all bundled component notices, source
provenance and applicable obligations. No binary release is authorized here.

Sources: [pinned driver release](https://pypi.org/project/psycopg/3.2.13/),
[pinned binary release](https://pypi.org/project/psycopg-binary/3.2.13/),
[upstream installation documentation](https://www.psycopg.org/psycopg3/docs/basic/install.html).
