-- «RutaWater Enviar.app»: lo único que tiene el permiso de Accesibilidad (30/10/2026).
-- No cambia nunca, así el permiso no se pierde: lo que hace está en
-- ~/.rutawater-mcp/enviar-whatsapp/enviar.applescript (enviar-whatsapp.applescript del repo).
on run
	set base to (POSIX path of (path to home folder)) & ".rutawater-mcp/enviar-whatsapp/"
	try
		run script (POSIX file (base & "enviar.applescript"))
	on error message number code
		set handle to open for access POSIX file (base & "resultado.txt") with write permission
		set eof handle to 0
		write ("error " & code & ": " & message) to handle as «class utf8»
		close access handle
	end try
end run
