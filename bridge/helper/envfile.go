package main

import (
	"errors"
	"io"
	"os"
)

// EnvVar is one NAME=value line of the env file.
type EnvVar struct {
	Name  string
	Value string
}

// ExitError carries the helper's exit code and a fixed-text message.
type ExitError struct {
	Code int
	Msg  string
}

func (e *ExitError) Error() string { return e.Msg }

// Test hooks.
var (
	writeAll = func(f *os.File, b []byte) error {
		_, err := f.Write(b)
		return err
	}
	openForWrite = func(path string) (*os.File, error) {
		return nil, errors.New("not implemented")
	}
	afterBackupWrite = func(string) {}
)

var errNotImplemented = errors.New("not implemented")

func UpsertEnv(content []byte, updates []EnvVar) ([]byte, error) { return nil, errNotImplemented }

func WriteInPlace(path string, content []byte) error { return errNotImplemented }

func BackupInPlace(path string, content []byte) error { return errNotImplemented }

func WriteMailboxPasswords(envPath, backupPath string, updates []EnvVar, out io.Writer) error {
	return errNotImplemented
}

// Mailbox is the part of a config.yaml mailbox the helper reads.
type Mailbox struct {
	Slug        string
	Username    string
	PasswordEnv string
}

// Account is the part of a Bridge account the helper uses.
type Account struct {
	Addresses []string
	Password  []byte
}

// PlannedWrite is one mailbox whose password goes into the env file.
type PlannedWrite struct {
	Slug string
	Name string
}

func (w PlannedWrite) Line() string { return "" }

// MailboxPlan is what configure will write and what it skips.
type MailboxPlan struct {
	Updates []EnvVar
	Writes  []PlannedWrite
	Skipped []string
}

func PlanMailboxPasswords(mailboxes []Mailbox, accounts []Account) MailboxPlan {
	return MailboxPlan{}
}
