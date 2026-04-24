# Secrets

These files are mounted into containers as Docker secrets (`/run/secrets/<name>`).
They are **never** embedded in environment variables in `docker-compose.yml`.

## Files

| File | Used by | Purpose |
|---|---|---|
| `db_password.txt` | `db` + `backend` | PostgreSQL password for `san_admin` |
| `mds_password.txt` | `backend` | Cisco MDS switch admin password |

## Before first deploy

```bash
# Change the DB password
echo "your_strong_db_password" > secrets/db_password.txt

# Set your MDS switch admin password
echo "your_mds_admin_password" > secrets/mds_password.txt

chmod 600 secrets/*.txt
```

## Security notes

- Add `secrets/` to `.gitignore` — **never commit these files**.
- In production, prefer Docker Swarm secrets or a vault (HashiCorp Vault,
  AWS Secrets Manager, etc.) over plain files.
- The `db_password.txt` value must match `POSTGRES_PASSWORD_FILE` in the `db`
  service and is read by the backend entrypoint to construct `DATABASE_URL`.
