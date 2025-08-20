-- Oracle setup and seed script
-- Run as SYSTEM user first to create user and grant privileges

-- Allow creation of local users (Oracle 12c+ feature)
ALTER SESSION SET "_ORACLE_SCRIPT"=true;

-- Create user (without C## prefix due to _ORACLE_SCRIPT)
CREATE USER todoapp IDENTIFIED BY DevPass123;

-- Grant necessary privileges
GRANT CONNECT, RESOURCE TO todoapp;
GRANT UNLIMITED TABLESPACE TO todoapp;
GRANT CREATE SESSION TO todoapp;
GRANT CREATE TABLE TO todoapp;
GRANT CREATE SEQUENCE TO todoapp;
GRANT CREATE TRIGGER TO todoapp;
GRANT CREATE TYPE TO todoapp;
GRANT CREATE PROCEDURE TO todoapp;
GRANT CREATE VIEW TO todoapp;

-- Exit to allow connection with todoapp user
EXIT;