-- Existing
CREATE DATABASE IF NOT EXISTS appdb_dev CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE IF NOT EXISTS appdb_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE USER IF NOT EXISTS 'app_dev'@'%'  IDENTIFIED BY 'app_dev_password';
CREATE USER IF NOT EXISTS 'app_test'@'%' IDENTIFIED BY 'app_test_password';

GRANT ALL PRIVILEGES ON appdb_dev.*  TO 'app_dev'@'%';
GRANT ALL PRIVILEGES ON appdb_test.* TO 'app_test'@'%';

-- 🔥 New: also allow your main app user to access dev/test DBs
GRANT ALL PRIVILEGES ON appdb_dev.*  TO 'app'@'%';
GRANT ALL PRIVILEGES ON appdb_test.* TO 'app'@'%';

FLUSH PRIVILEGES;
