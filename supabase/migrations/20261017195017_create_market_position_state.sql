CREATE TABLE IF NOT EXISTS market_position_state (
    condition_id text NOT NULL,
    outcome text NOT NULL,
    resolved boolean NOT NULL DEFAULT false,
    PRIMARY KEY (condition_id, outcome)
);
CREATE INDEX IF NOT EXISTS market_position_state_open_idx ON market_position_state (condition_id, outcome) WHERE NOT resolved;
