<?php
class DBConn {
    private $pdo = null;
    private $mode = null; // can be 'INDICES', 'COLUMN_NAMES' or 'BOTH'
    private $log = null;
    private $databaseName = null;

    function __construct($host, $port, $databaseName, $user, $password, $mode) {
        $dsn = "mysql:host=$host:$port;dbname=$databaseName";
        try {
            $this->pdo = new PDO($dsn, $user, $password, array(PDO::MYSQL_ATTR_FOUND_ROWS => true));
            if (!$this->pdo){
                echo 'Could not connect to DB!';
            }
        } catch (PDOException $e){
            echo $e->getMessage();
        }
        $this->mode = $mode;
        $this->databaseName = $databaseName;
    }
    
    /**
     * Set the log to enable error logging.
     */
    function setLog($log) {
        $this->log = $log;
    }
    
    /**
     * Returns the name of the DB this PDO is connected to.
     */
    function getDbName() {
        return $this->databaseName;
    }
    
    /**
     * Executes the SQL insert/update command(s) using the values in the given list returning the last insert id and the row count.
     */
    function exec($sqlString, $values) {
		$sqlString = str_replace('"', '', $sqlString);
        $stmt = $this->pdo->prepare($sqlString);
        $stmt->execute($values);
        if (!($this->pdo->errorInfo()[0] == '00000')) {
            $this->logPdoError($this->pdo->errorInfo());
        }
        $retVal = ['lastInsertId'=>$this->pdo->lastInsertId(), 'rowCount'=>$stmt->rowCount()];
        return $retVal;
    }
    
    /**
     * Executes the SQL select command(s) returning the results or FALSE if there was an error.
     */
    function query($sqlString) {
		$sqlString = str_replace('"', '', $sqlString);
        $retArray = array();
        $query = $this->pdo->query($sqlString);
        if (!($this->pdo->errorInfo()[0] == '00000')) {
            $this->logPdoError($this->pdo->errorInfo());
        }
        if ($query) {
            foreach ($query as $row) {
                $f = array_filter(
                                    $row,
                                    function ($key) {
                                        if ($this->mode == 'INDICES') {
                                            return is_numeric($key);
                                        }
                                        if ($this->mode == 'COLUMN_NAMES') {
                                            return !is_numeric($key);
                                        }
                                        return true;
                                    },
                                    ARRAY_FILTER_USE_KEY
                                );
                $retArray[] = $f;
            }
            if (isset($retArray[0]['COUNT(*)'])) {
                $retArray[0]["count"] = $retArray[0]['COUNT(*)'];
            }
            return $retArray;
        }
        return false;
    }
    
    /**
     * If something went wrong on executing SQL statements, log the errors.
     */
    function logPdoError($errorInfo) {
        $error = '[';
        $error .= 'SQLSTATE error code: ' . $errorInfo[0];
        $error .= ', Driver-specific error code: ' . $errorInfo[1];
        $error .= ', Driver-specific error message: ' . $errorInfo[2];
        $error .= ']';
        if ($this->log != null) {
            $this->log->critical(static::class . '.php', 'Database returned error: ' . $error);
        } else {
            echo static::class . '.php' . 'Database returned error: ' . $error;
        }
    }
}
?>
