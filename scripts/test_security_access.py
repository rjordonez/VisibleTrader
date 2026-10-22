"""Dev-only security regression suite. All fixtures and writes are rolled back.
Run: .venv/bin/python scripts/test_security_access.py
"""
import os
import json
from urllib.parse import urlparse
from uuid import uuid4
import psycopg
from _env import load_env

DEV_REF = "lfebcdrczausvohsyxfa"
INTERNAL = ["opportunity_aggregate_dirty", "leaderboard_refresh_state", "opportunity_wallet_max_usd",
            "wallet_category_breakdown_refresh_state", "market_position_state", "profit_bot_dirty",
            "paid_subscribers", "live_activity_tokens"]

def main():
    load_env()
    dsn = os.environ["DEV_DATABASE_URL"]
    parsed = urlparse(dsn)
    if DEV_REF not in (parsed.hostname or "") and DEV_REF not in (parsed.username or ""):
        raise SystemExit("Refusing to test: DEV_DATABASE_URL must identify the approved dev project")
    checks = 0
    with psycopg.connect(dsn) as conn:
        try:
            with conn.cursor() as cur:
                def check(condition, message):
                    nonlocal checks
                    if not condition:
                        raise AssertionError(message)
                    checks += 1
                def role(name, uid=None):
                    cur.execute("RESET ROLE")
                    cur.execute("select set_config('request.jwt.claim.sub', %s, true), set_config('request.jwt.claims', %s, true)",
                                (str(uid) if uid else "", json.dumps({'role': name, **({'sub': str(uid)} if uid else {})})))
                    cur.execute(psycopg.sql.SQL("SET LOCAL ROLE {}").format(psycopg.sql.Identifier(name)))
                def denied(statement, params=None):
                    cur.execute("SAVEPOINT denied_write")
                    try:
                        cur.execute(statement, params)
                    except psycopg.errors.InsufficientPrivilege:
                        cur.execute("ROLLBACK TO SAVEPOINT denied_write")
                        check(True, "denied")
                    else:
                        cur.execute("ROLLBACK TO SAVEPOINT denied_write")
                        raise AssertionError("Unexpected access: " + str(statement))
                    cur.execute("RELEASE SAVEPOINT denied_write")
                first, second = uuid4(), uuid4()
                for uid in [first, second]:
                    cur.execute("INSERT INTO auth.users(id, email) VALUES (%s, %s)", (uid, f"security-{uid}@example.invalid"))
                cur.execute("INSERT INTO public.subscriptions(user_id,status,plan) VALUES (%s,'active','pro')", (first,))
                wallet = "security-test-" + str(uuid4())
                cur.execute("INSERT INTO public.wallet_balances(wallet,usdc_balance) VALUES (%s,123)", (wallet,))
                cur.execute("INSERT INTO public.personal_pnl_entries(user_id,entry_date,amount) VALUES (%s,current_date,7),(%s,current_date,9)", (first, second))
                cur.execute("INSERT INTO public.paid_subscribers(email) VALUES ('security-test@example.invalid')")
                cur.execute("SELECT count(*) FROM public.paid_subscribers")
                expected_count = cur.fetchone()[0]
                for name, uid in [("anon", None), ("authenticated", second), ("authenticated", first)]:
                    role(name, uid)
                    for table in INTERNAL:
                        # WHERE false checks access without altering any existing row.
                        ident = psycopg.sql.Identifier("public", table)
                        denied(psycopg.sql.SQL("SELECT * FROM {} LIMIT 1").format(ident))
                        denied(psycopg.sql.SQL("DELETE FROM {} WHERE false").format(ident))
                        cur.execute("RESET ROLE")
                        cur.execute("SELECT attname FROM pg_attribute WHERE attrelid=%s::regclass AND attnum>0 AND NOT attisdropped ORDER BY attnum LIMIT 1", ("public."+table,))
                        column = cur.fetchone()[0]
                        role(name, uid)
                        denied(psycopg.sql.SQL("UPDATE {} SET {}={} WHERE false").format(ident, psycopg.sql.Identifier(column), psycopg.sql.Identifier(column)))
                        denied(psycopg.sql.SQL("INSERT INTO {} DEFAULT VALUES").format(ident))
                    denied("UPDATE public.app_settings SET ticker_min_usd=1 WHERE id=1")
                    for table in ["creator_stats", "tiktok_creator_stats"]:
                        denied(psycopg.sql.SQL("INSERT INTO public.{}(creator,media_pk,view_count) VALUES ('forged','forged',999)").format(psycopg.sql.Identifier(table)))
                        cur.execute(psycopg.sql.SQL("SELECT count(*) FROM public.{}").format(psycopg.sql.Identifier(table)))
                        check(cur.fetchone()[0] >= 0, "public stats remain readable")
                    cur.execute("SELECT public.public_paid_subscriber_count()")
                    check(cur.fetchone()[0] == expected_count, "aggregate available without email access")
                    cur.execute("SELECT count(*) FROM public.wallet_balances WHERE wallet=%s", (wallet,))
                    check(cur.fetchone()[0] == (1 if uid == first else 0), "subscription access preserved")
                    if uid:
                        cur.execute("SELECT amount FROM public.personal_pnl_entries WHERE user_id IN (%s,%s)", (first, second))
                        check([r[0] for r in cur.fetchall()] == [7 if uid == first else 9], "journal row isolation")
                        cur.execute("UPDATE public.personal_pnl_entries SET amount=amount+1 WHERE user_id=%s", (second if uid == first else first,))
                        check(cur.rowcount == 0, "cross-user updates blocked")
                        denied("UPDATE public.personal_pnl_entries SET user_id=%s WHERE user_id=%s", (second if uid == first else first, uid))
                role("service_role")
                for table in INTERNAL:
                    cur.execute(psycopg.sql.SQL("SELECT * FROM public.{} LIMIT 1").format(psycopg.sql.Identifier(table)))
                    check(True, "backend access")
                cur.execute("INSERT INTO public.profit_bot_dirty(condition_id,outcome) VALUES (%s,'security-test')", (wallet,))
                cur.execute("DELETE FROM public.profit_bot_dirty WHERE condition_id=%s", (wallet,))
                check(cur.rowcount == 1, "backend queue writes")
                for table in ["creator_stats", "tiktok_creator_stats"]:
                    cur.execute(psycopg.sql.SQL("INSERT INTO public.{}(creator,media_pk,view_count) VALUES ('security-test',%s,1)").format(psycopg.sql.Identifier(table)), (wallet,))
                    check(cur.rowcount == 1, "trusted scraper ingestion")
                cur.execute("UPDATE public.app_settings SET ticker_min_usd=ticker_min_usd WHERE id=1")
                check(cur.rowcount == 1, "backend configuration update")
                cur.execute("SAVEPOINT bad_config")
                try:
                    cur.execute("UPDATE public.app_settings SET whale_roster_size=-1 WHERE id=1")
                except psycopg.errors.CheckViolation:
                    cur.execute("ROLLBACK TO SAVEPOINT bad_config")
                    check(True, "database rejects invalid configuration")
                else:
                    raise AssertionError("Invalid configuration accepted")
                cur.execute("RESET ROLE")
        finally:
            conn.rollback()
    print(f"PASS: {checks} dev security assertions; all test data and writes rolled back")

if __name__ == "__main__":
    main()
